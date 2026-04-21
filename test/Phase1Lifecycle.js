const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Phase 4 Pricing Lifecycle", function () {
  const AAPL = ethers.encodeBytes32String("AAPL");
  const MSFT = ethers.encodeBytes32String("MSFT");
  const NVDA = ethers.encodeBytes32String("NVDA");
  const TSLA = ethers.encodeBytes32String("TSLA");
  const USDC_DECIMALS = 6;

  function riskSnapshot({
    impliedVolBps,
    downsideSkewBps,
    upsideSkewBps,
    shortTermMultiplierBps,
    mediumTermMultiplierBps,
    longTermMultiplierBps,
    downsideInventoryPressureBps,
    upsideInventoryPressureBps,
    stressPremiumBps,
    riskScoreBps,
    sourceTag
  }) {
    return {
      impliedVolBps,
      downsideSkewBps,
      upsideSkewBps,
      shortTermMultiplierBps,
      mediumTermMultiplierBps,
      longTermMultiplierBps,
      downsideInventoryPressureBps,
      upsideInventoryPressureBps,
      stressPremiumBps,
      riskScoreBps,
      updatedAt: Math.floor(Date.now() / 1000),
      sourceTag: ethers.encodeBytes32String(sourceTag)
    };
  }

  async function deployFixture() {
    const [owner, lp, buyer] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy(owner.address);
    await mockUsdc.waitForDeployment();

    const MockRiskParameterProvider = await ethers.getContractFactory("MockRiskParameterProvider");
    const riskParameterProvider = await MockRiskParameterProvider.deploy(owner.address);
    await riskParameterProvider.waitForDeployment();

    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const spotFeed = await MockPriceFeed.deploy(185n * 10n ** 8n, 8, owner.address);
    await spotFeed.waitForDeployment();

    const PricingOracle = await ethers.getContractFactory("PricingOracle");
    const pricingOracle = await PricingOracle.deploy(owner.address, await riskParameterProvider.getAddress());
    await pricingOracle.waitForDeployment();

    const InsuranceVault = await ethers.getContractFactory("InsuranceVault");
    const insuranceVault = await InsuranceVault.deploy(owner.address, await mockUsdc.getAddress());
    await insuranceVault.waitForDeployment();

    const PolicyFactory = await ethers.getContractFactory("PolicyFactory");
    const policyFactory = await PolicyFactory.deploy(
      owner.address,
      await insuranceVault.getAddress(),
      await pricingOracle.getAddress()
    );
    await policyFactory.waitForDeployment();

    const baseConfig = {
      spotFeed: await spotFeed.getAddress(),
      minDuration: 3600,
      maxDuration: 30 * 24 * 3600,
      basePremiumBps: 150,
      maxNotional: ethers.parseUnits("50000", USDC_DECIMALS),
      minTriggerBps: 500,
      maxTriggerBps: 2000,
      openMinutesUtc: 570,
      closeMinutesUtc: 960,
      enforceMarketHours: false,
      isActive: true
    };

    await pricingOracle.configureMarket(AAPL, baseConfig);
    await pricingOracle.configureMarket(TSLA, {
      ...baseConfig,
      basePremiumBps: 190
    });
    await pricingOracle.configureMarket(NVDA, {
      ...baseConfig,
      basePremiumBps: 175
    });
    await pricingOracle.configureMarket(MSFT, {
      ...baseConfig,
      basePremiumBps: 135
    });

    await riskParameterProvider.setRiskSnapshot(
      AAPL,
      riskSnapshot({
        impliedVolBps: 2800,
        downsideSkewBps: 120,
        upsideSkewBps: 90,
        shortTermMultiplierBps: 10250,
        mediumTermMultiplierBps: 10000,
        longTermMultiplierBps: 9650,
        downsideInventoryPressureBps: 80,
        upsideInventoryPressureBps: 45,
        stressPremiumBps: 55,
        riskScoreBps: 6200,
        sourceTag: "TEST_AAPL"
      })
    );
    await riskParameterProvider.setRiskSnapshot(
      TSLA,
      riskSnapshot({
        impliedVolBps: 4200,
        downsideSkewBps: 180,
        upsideSkewBps: 140,
        shortTermMultiplierBps: 10800,
        mediumTermMultiplierBps: 10300,
        longTermMultiplierBps: 9800,
        downsideInventoryPressureBps: 130,
        upsideInventoryPressureBps: 90,
        stressPremiumBps: 85,
        riskScoreBps: 7600,
        sourceTag: "TEST_TSLA"
      })
    );
    await riskParameterProvider.setRiskSnapshot(
      NVDA,
      riskSnapshot({
        impliedVolBps: 3600,
        downsideSkewBps: 150,
        upsideSkewBps: 120,
        shortTermMultiplierBps: 10550,
        mediumTermMultiplierBps: 10150,
        longTermMultiplierBps: 9750,
        downsideInventoryPressureBps: 110,
        upsideInventoryPressureBps: 70,
        stressPremiumBps: 70,
        riskScoreBps: 7100,
        sourceTag: "TEST_NVDA"
      })
    );
    await riskParameterProvider.setRiskSnapshot(
      MSFT,
      riskSnapshot({
        impliedVolBps: 2100,
        downsideSkewBps: 100,
        upsideSkewBps: 85,
        shortTermMultiplierBps: 10150,
        mediumTermMultiplierBps: 9950,
        longTermMultiplierBps: 9700,
        downsideInventoryPressureBps: 60,
        upsideInventoryPressureBps: 35,
        stressPremiumBps: 40,
        riskScoreBps: 5400,
        sourceTag: "TEST_MSFT"
      })
    );
    await insuranceVault.setPolicyManager(await policyFactory.getAddress());
    await mockUsdc.mint(lp.address, ethers.parseUnits("250000", USDC_DECIMALS));
    await mockUsdc.mint(buyer.address, ethers.parseUnits("50000", USDC_DECIMALS));

    return {
      owner,
      lp,
      buyer,
      mockUsdc,
      spotFeed,
      riskParameterProvider,
      pricingOracle,
      insuranceVault,
      policyFactory,
      baseConfig
    };
  }

  async function approveAndDeposit(mockUsdc, insuranceVault, account, amount) {
    await mockUsdc.connect(account).approve(await insuranceVault.getAddress(), amount);
    await insuranceVault.connect(account).deposit(amount);
  }

  it("quotes and purchases a downside policy", async function () {
    const { lp, buyer, mockUsdc, pricingOracle, insuranceVault, policyFactory } = await loadFixture(deployFixture);

    const lpDeposit = ethers.parseUnits("10000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const deductible = ethers.parseUnits("50", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("600", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);

    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, deductible, payoutCap);
    expect(quote.premium).to.be.gt(0);
    expect(quote.spotPrice).to.equal(ethers.parseEther("185"));
    expect(quote.strikePrice).to.equal((ethers.parseEther("185") * 9000n) / 10000n);
    expect(quote.triggerBps).to.equal(1000);
    expect(quote.notional).to.equal(notional);
    expect(quote.annualVolBps).to.equal(2800);
    expect(quote.directionalRiskBps).to.equal(120);
    expect(quote.termStructureMultiplierBps).to.equal(10250);
    expect(await pricingOracle.isSupportedSymbol(AAPL)).to.equal(true);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, deductible, payoutCap);

    const policy = await policyFactory.getPolicy(1);
    expect(policy.id).to.equal(1);
    expect(policy.holder).to.equal(buyer.address);
    expect(policy.symbol).to.equal(AAPL);
    expect(policy.triggerBps).to.equal(1000);
    expect(policy.notional).to.equal(notional);
    expect(policy.deductible).to.equal(deductible);
    expect(policy.payoutCap).to.equal(payoutCap);
    expect(policy.premiumPaid).to.equal(quote.premium);
    expect(policy.status).to.equal(0);
    expect(policy.createdAt).to.be.gt(0);
    expect(await insuranceVault.totalReserved()).to.equal(payoutCap);
    expect(await insuranceVault.totalAssets()).to.equal(lpDeposit + quote.premium);
    expect(await insuranceVault.realizedPremiums()).to.equal(quote.premium);
  });

  it("runs the full downside lifecycle and pays a claim", async function () {
    const { lp, buyer, mockUsdc, spotFeed, insuranceVault, policyFactory } = await loadFixture(deployFixture);

    const lpDeposit = ethers.parseUnits("10000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const deductible = ethers.parseUnits("50", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("600", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, deductible, payoutCap);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    const purchaseTx = await policyFactory.connect(buyer).purchasePolicy(
      AAPL,
      true,
      notional,
      24 * 3600,
      1000,
      deductible,
      payoutCap
    );
    await purchaseTx.wait();

    const purchasedPolicy = await policyFactory.getPolicy(1);
    await spotFeed.setAnswer(120n * 10n ** 8n);
    await time.increaseTo(Number(purchasedPolicy.expiry) + 1);

    const buyerBalanceBefore = await mockUsdc.balanceOf(buyer.address);
    const settleTx = await policyFactory.connect(lp).settlePolicy(1);
    await settleTx.wait();

    const settledPolicy = await policyFactory.getPolicy(1);
    const rawPayout =
      (purchasedPolicy.notional * (purchasedPolicy.strikePrice - ethers.parseEther("120"))) / purchasedPolicy.entryPrice;
    const expectedPayout = rawPayout > purchasedPolicy.deductible
      ? rawPayout - purchasedPolicy.deductible
      : 0n;

    expect(settledPolicy.exitPrice).to.equal(ethers.parseEther("120"));
    expect(settledPolicy.payoutAmount).to.equal(expectedPayout);
    expect(settledPolicy.status).to.equal(1);
    expect(settledPolicy.settledAt).to.be.gt(settledPolicy.createdAt);
    expect(await mockUsdc.balanceOf(buyer.address)).to.equal(buyerBalanceBefore + expectedPayout);
    expect(await insuranceVault.totalReserved()).to.equal(0);
    expect(await insuranceVault.totalAssets()).to.equal(lpDeposit + quote.premium - expectedPayout);
    expect(await insuranceVault.totalClaimsPaid()).to.equal(expectedPayout);
  });

  it("releases reserved liquidity when no payout is due", async function () {
    const { lp, buyer, mockUsdc, spotFeed, insuranceVault, policyFactory } = await loadFixture(deployFixture);

    const lpDeposit = ethers.parseUnits("5000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("600", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    const purchasedPolicy = await policyFactory.getPolicy(1);
    await spotFeed.setAnswer(200n * 10n ** 8n);
    await time.increaseTo(Number(purchasedPolicy.expiry) + 1);

    await policyFactory.settlePolicy(1);

    const settledPolicy = await policyFactory.getPolicy(1);
    expect(settledPolicy.payoutAmount).to.equal(0);
    expect(await insuranceVault.totalReserved()).to.equal(0);
    expect(await insuranceVault.totalAssets()).to.equal(lpDeposit + quote.premium);
    expect(await insuranceVault.netUnderwritingResult()).to.equal(quote.premium);
  });

  it("reverts if settlement is attempted before expiry", async function () {
    const { lp, buyer, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);

    const lpDeposit = ethers.parseUnits("5000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("600", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await expect(policyFactory.settlePolicy(1)).to.be.revertedWithCustomError(
      policyFactory,
      "PolicyNotExpired"
    );
  });

  it("reverts for unsupported symbols", async function () {
    const { policyFactory } = await loadFixture(deployFixture);

    await expect(
      policyFactory.previewPolicy(ethers.encodeBytes32String("META"), true, ethers.parseUnits("1000", USDC_DECIMALS), 24 * 3600, 1000, 0, ethers.parseUnits("500", USDC_DECIMALS))
    ).to.be.revertedWithCustomError(policyFactory, "UnsupportedSymbol");
  });

  it("supports multiple whitelisted symbols", async function () {
    const { pricingOracle } = await loadFixture(deployFixture);

    expect(await pricingOracle.isSupportedSymbol(AAPL)).to.equal(true);
    expect(await pricingOracle.isSupportedSymbol(TSLA)).to.equal(true);
    expect(await pricingOracle.isSupportedSymbol(NVDA)).to.equal(true);
    expect(await pricingOracle.isSupportedSymbol(MSFT)).to.equal(true);
  });

  it("uses risk snapshots to differentiate premiums across symbols", async function () {
    const { lp, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, ethers.parseUnits("20000", USDC_DECIMALS));

    const aaplQuote = await policyFactory.previewPolicy(
      AAPL,
      true,
      ethers.parseUnits("1000", USDC_DECIMALS),
      24 * 3600,
      1000,
      0,
      ethers.parseUnits("500", USDC_DECIMALS)
    );
    const tslaQuote = await policyFactory.previewPolicy(
      TSLA,
      true,
      ethers.parseUnits("1000", USDC_DECIMALS),
      24 * 3600,
      1000,
      0,
      ethers.parseUnits("500", USDC_DECIMALS)
    );

    expect(tslaQuote.premium).to.be.gt(aaplQuote.premium);
    expect(tslaQuote.annualVolBps).to.equal(4200);
    expect(tslaQuote.riskScoreBps).to.equal(7600);
  });

  it("blocks triggers outside the 5 to 20 percent range", async function () {
    const { policyFactory, pricingOracle } = await loadFixture(deployFixture);

    await expect(
      policyFactory.previewPolicy(AAPL, true, ethers.parseUnits("1000", USDC_DECIMALS), 24 * 3600, 300, 0, ethers.parseUnits("500", USDC_DECIMALS))
    ).to.be.revertedWithCustomError(pricingOracle, "InvalidTrigger");
  });

  it("rejects quotes when the risk snapshot is missing", async function () {
    const { owner, pricingOracle } = await loadFixture(deployFixture);
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const amznSpotFeed = await MockPriceFeed.deploy(178n * 10n ** 8n, 8, owner.address);
    await amznSpotFeed.waitForDeployment();

    await pricingOracle.configureMarket(ethers.encodeBytes32String("AMZN"), {
      spotFeed: await amznSpotFeed.getAddress(),
      minDuration: 3600,
      maxDuration: 30 * 24 * 3600,
      basePremiumBps: 155,
      maxNotional: ethers.parseUnits("50000", USDC_DECIMALS),
      minTriggerBps: 500,
      maxTriggerBps: 2000,
      openMinutesUtc: 570,
      closeMinutesUtc: 960,
      enforceMarketHours: false,
      isActive: true
    });

    await expect(
      pricingOracle.quotePremium(
        ethers.encodeBytes32String("AMZN"),
        ethers.parseUnits("1000", USDC_DECIMALS),
        24 * 3600,
        1000,
        0,
        ethers.parseUnits("500", USDC_DECIMALS),
        0,
        true
      )
    ).to.be.revertedWithCustomError(pricingOracle, "MissingRiskSnapshot");
  });

  it("cancels a policy after the lock delay without refunding premium", async function () {
    const { lp, buyer, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);

    const lpDeposit = ethers.parseUnits("5000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("500", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);
    const buyerBalanceBeforePurchase = await mockUsdc.balanceOf(buyer.address);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await time.increase(31 * 60);
    await policyFactory.connect(buyer).cancelPolicy(1);

    const cancelledPolicy = await policyFactory.getPolicy(1);
    expect(cancelledPolicy.status).to.equal(2);
    expect(await insuranceVault.totalReserved()).to.equal(0);
    expect(await mockUsdc.balanceOf(buyer.address)).to.equal(buyerBalanceBeforePurchase - quote.premium);
  });

  it("blocks cancellation during the lock delay", async function () {
    const { lp, buyer, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);

    const lpDeposit = ethers.parseUnits("5000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("500", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await expect(policyFactory.connect(buyer).cancelPolicy(1)).to.be.revertedWithCustomError(
      policyFactory,
      "CancellationLocked"
    );
  });

  it("blocks withdrawing liquidity that is still reserved", async function () {
    const { lp, buyer, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);

    const lpDeposit = ethers.parseUnits("5000", USDC_DECIMALS);
    const notional = ethers.parseUnits("4000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("3500", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    const sharesMinted = await insuranceVault.shareBalance(lp.address);
    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await expect(insuranceVault.connect(lp).withdraw(sharesMinted)).to.be.revertedWithCustomError(
      insuranceVault,
      "InsufficientLiquidity"
    );
  });

  it("respects configured market hours when enforcement is enabled", async function () {
    const { pricingOracle, baseConfig } = await loadFixture(deployFixture);

    await pricingOracle.configureMarket(ethers.encodeBytes32String("AMD"), {
      ...baseConfig,
      enforceMarketHours: true
    });

    const latest = await time.latest();
    let targetDay = Math.floor(latest / 86400) + 1;

    while (((targetDay + 4) % 7) === 0 || ((targetDay + 4) % 7) === 6) {
      targetDay += 1;
    }

    await time.increaseTo(targetDay * 86400 + 2 * 3600);
    expect(await pricingOracle.isMarketOpen(ethers.encodeBytes32String("AMD"))).to.equal(false);

    await time.increaseTo(targetDay * 86400 + 10 * 3600);
    expect(await pricingOracle.isMarketOpen(ethers.encodeBytes32String("AMD"))).to.equal(true);
  });

  it("rejects utilization above 100 percent", async function () {
    const { pricingOracle } = await loadFixture(deployFixture);

    await expect(
      pricingOracle.quotePremium(
        AAPL,
        ethers.parseUnits("1000", USDC_DECIMALS),
        24 * 3600,
        1000,
        0,
        ethers.parseUnits("500", USDC_DECIMALS),
        10001,
        true
      )
    ).to.be.revertedWithCustomError(pricingOracle, "InvalidUtilization");
  });

  it("tracks underwriting metrics and LP share price after profit", async function () {
    const { lp, buyer, mockUsdc, spotFeed, insuranceVault, policyFactory } = await loadFixture(deployFixture);

    const lpDeposit = ethers.parseUnits("10000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("500", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);

    const initialSharePrice = await insuranceVault.sharePrice();
    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    const purchasedPolicy = await policyFactory.getPolicy(1);
    await spotFeed.setAnswer(200n * 10n ** 8n);
    await time.increaseTo(Number(purchasedPolicy.expiry) + 1);
    await policyFactory.settlePolicy(1);

    expect(await insuranceVault.realizedPremiums()).to.equal(quote.premium);
    expect(await insuranceVault.totalClaimsPaid()).to.equal(0);
    expect(await insuranceVault.netUnderwritingResult()).to.equal(quote.premium);
    expect(await insuranceVault.sharePrice()).to.be.gt(initialSharePrice);
  });
});
