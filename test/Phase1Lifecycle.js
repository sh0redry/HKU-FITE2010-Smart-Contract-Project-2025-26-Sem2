const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Phase 8 Governance And Multi-Market Lifecycle", function () {
  const AAPL = ethers.encodeBytes32String("AAPL");
  const MSFT = ethers.encodeBytes32String("MSFT");
  const NVDA = ethers.encodeBytes32String("NVDA");
  const TSLA = ethers.encodeBytes32String("TSLA");
  const HK_0700 = ethers.encodeBytes32String("0700HK");
  const HK_9988 = ethers.encodeBytes32String("9988HK");
  const HK_0005 = ethers.encodeBytes32String("0005HK");
  const USDC_DECIMALS = 6;
  const SETTLEMENT_MODE_CURRENT = 0;
  const SETTLEMENT_MODE_NEXT_OPEN = 1;
  const CALENDAR_US = 1;
  const CALENDAR_HK = 2;

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
    const [owner, lp, buyer, riskManager, oracleManager, pauser] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy(owner.address);
    await mockUsdc.waitForDeployment();

    const MockRiskParameterProvider = await ethers.getContractFactory("MockRiskParameterProvider");
    const riskParameterProvider = await MockRiskParameterProvider.deploy(owner.address);
    await riskParameterProvider.waitForDeployment();

    const ChainlinkOracleAdapter = await ethers.getContractFactory("ChainlinkOracleAdapter");
    const oracleAdapter = await ChainlinkOracleAdapter.deploy(owner.address);
    await oracleAdapter.waitForDeployment();

    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const spotFeed = await MockPriceFeed.deploy(185n * 10n ** 8n, 8, owner.address);
    await spotFeed.waitForDeployment();

    const PricingOracle = await ethers.getContractFactory("PricingOracle");
    const pricingOracle = await PricingOracle.deploy(
      owner.address,
      await riskParameterProvider.getAddress(),
      await oracleAdapter.getAddress()
    );
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

    const PolicySettlementAutomation = await ethers.getContractFactory("PolicySettlementAutomation");
    const settlementAutomation = await PolicySettlementAutomation.deploy(await policyFactory.getAddress(), 10);
    await settlementAutomation.waitForDeployment();

    const baseConfig = {
      minDuration: 3600,
      maxDuration: 30 * 24 * 3600,
      basePremiumBps: 150,
      maxNotional: ethers.parseUnits("50000", USDC_DECIMALS),
      minTriggerBps: 500,
      maxTriggerBps: 2000,
      openMinutesLocal: 570,
      closeMinutesLocal: 960,
      closeBufferMinutes: 15,
      overnightGapSurchargeBps: 120,
      enforceMarketHours: false,
      calendarType: CALENDAR_US,
      allowFallbackOracle: true,
      settlementMode: SETTLEMENT_MODE_CURRENT,
      isActive: true
    };

    const hkConfig = {
      ...baseConfig,
      basePremiumBps: 160,
      enforceMarketHours: true,
      calendarType: CALENDAR_HK,
      settlementMode: SETTLEMENT_MODE_CURRENT
    };

    await oracleAdapter.configureFeed(AAPL, {
      primaryFeed: await spotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(AAPL, baseConfig);

    const tslaSpotFeed = await MockPriceFeed.deploy(172n * 10n ** 8n, 8, owner.address);
    await tslaSpotFeed.waitForDeployment();
    await oracleAdapter.configureFeed(TSLA, {
      primaryFeed: await tslaSpotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(TSLA, {
      ...baseConfig,
      basePremiumBps: 190
    });

    const nvdaSpotFeed = await MockPriceFeed.deploy(890n * 10n ** 8n, 8, owner.address);
    await nvdaSpotFeed.waitForDeployment();
    await oracleAdapter.configureFeed(NVDA, {
      primaryFeed: await nvdaSpotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(NVDA, {
      ...baseConfig,
      basePremiumBps: 175
    });

    const msftSpotFeed = await MockPriceFeed.deploy(415n * 10n ** 8n, 8, owner.address);
    await msftSpotFeed.waitForDeployment();
    await oracleAdapter.configureFeed(MSFT, {
      primaryFeed: await msftSpotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(MSFT, {
      ...baseConfig,
      basePremiumBps: 135
    });
    const hk0700SpotFeed = await MockPriceFeed.deploy(320n * 10n ** 8n, 8, owner.address);
    await hk0700SpotFeed.waitForDeployment();
    await oracleAdapter.configureFeed(HK_0700, {
      primaryFeed: await hk0700SpotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(HK_0700, hkConfig);

    const hk9988SpotFeed = await MockPriceFeed.deploy(92n * 10n ** 8n, 8, owner.address);
    await hk9988SpotFeed.waitForDeployment();
    await oracleAdapter.configureFeed(HK_9988, {
      primaryFeed: await hk9988SpotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(HK_9988, {
      ...hkConfig,
      basePremiumBps: 170
    });

    const hk0005SpotFeed = await MockPriceFeed.deploy(64n * 10n ** 8n, 8, owner.address);
    await hk0005SpotFeed.waitForDeployment();
    await oracleAdapter.configureFeed(HK_0005, {
      primaryFeed: await hk0005SpotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(HK_0005, {
      ...hkConfig,
      basePremiumBps: 140
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
    await riskParameterProvider.setRiskSnapshot(
      HK_0700,
      riskSnapshot({
        impliedVolBps: 2600,
        downsideSkewBps: 115,
        upsideSkewBps: 90,
        shortTermMultiplierBps: 10180,
        mediumTermMultiplierBps: 9980,
        longTermMultiplierBps: 9720,
        downsideInventoryPressureBps: 70,
        upsideInventoryPressureBps: 45,
        stressPremiumBps: 48,
        riskScoreBps: 5900,
        sourceTag: "TEST_HK0700"
      })
    );
    await riskParameterProvider.setRiskSnapshot(
      HK_9988,
      riskSnapshot({
        impliedVolBps: 3000,
        downsideSkewBps: 135,
        upsideSkewBps: 105,
        shortTermMultiplierBps: 10350,
        mediumTermMultiplierBps: 10080,
        longTermMultiplierBps: 9760,
        downsideInventoryPressureBps: 85,
        upsideInventoryPressureBps: 55,
        stressPremiumBps: 56,
        riskScoreBps: 6400,
        sourceTag: "TEST_HK9988"
      })
    );
    await riskParameterProvider.setRiskSnapshot(
      HK_0005,
      riskSnapshot({
        impliedVolBps: 2200,
        downsideSkewBps: 95,
        upsideSkewBps: 80,
        shortTermMultiplierBps: 10080,
        mediumTermMultiplierBps: 9920,
        longTermMultiplierBps: 9680,
        downsideInventoryPressureBps: 52,
        upsideInventoryPressureBps: 32,
        stressPremiumBps: 38,
        riskScoreBps: 5200,
        sourceTag: "TEST_HK0005"
      })
    );
    await insuranceVault.setPolicyManager(await policyFactory.getAddress());
    await pricingOracle.grantRole(await pricingOracle.RISK_MANAGER_ROLE(), riskManager.address);
    await pricingOracle.grantRole(await pricingOracle.ORACLE_MANAGER_ROLE(), oracleManager.address);
    await pricingOracle.grantRole(await pricingOracle.PAUSER_ROLE(), pauser.address);
    await policyFactory.grantRole(await policyFactory.RISK_MANAGER_ROLE(), riskManager.address);
    await policyFactory.grantRole(await policyFactory.PAUSER_ROLE(), pauser.address);
    await policyFactory.configureRiskLimits(
      9000,
      8500,
      0,
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS)
    );
    await mockUsdc.mint(lp.address, ethers.parseUnits("250000", USDC_DECIMALS));
    await mockUsdc.mint(buyer.address, ethers.parseUnits("50000", USDC_DECIMALS));

    return {
      owner,
      lp,
      buyer,
      riskManager,
      oracleManager,
      pauser,
      mockUsdc,
      spotFeed,
      tslaSpotFeed,
      nvdaSpotFeed,
      msftSpotFeed,
      hk0700SpotFeed,
      hk9988SpotFeed,
      hk0005SpotFeed,
      oracleAdapter,
      riskParameterProvider,
      pricingOracle,
      insuranceVault,
      policyFactory,
      settlementAutomation,
      baseConfig
    };
  }

  async function approveAndDeposit(mockUsdc, insuranceVault, account, amount) {
    await mockUsdc.connect(account).approve(await insuranceVault.getAddress(), amount);
    await insuranceVault.connect(account).deposit(amount);
  }

  function utcTimestamp(year, monthIndex, day, hour, minute = 0) {
    return Math.floor(Date.UTC(year, monthIndex, day, hour, minute, 0) / 1000);
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
    expect(quote.overnightGapSurchargeBps).to.equal(120);
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
    expect(await pricingOracle.isSupportedSymbol(HK_0700)).to.equal(true);
    expect(await pricingOracle.isSupportedSymbol(HK_9988)).to.equal(true);
    expect(await pricingOracle.isSupportedSymbol(HK_0005)).to.equal(true);
  });

  it("lets Hong Kong symbols be quoted and bought independently from U.S. symbols", async function () {
    const { lp, buyer, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, ethers.parseUnits("20000", USDC_DECIMALS));
    await time.increaseTo(utcTimestamp(2026, 6, 15, 1, 45));

    const quote = await policyFactory.previewPolicy(
      HK_0700,
      false,
      ethers.parseUnits("1200", USDC_DECIMALS),
      12 * 3600,
      500,
      ethers.parseUnits("10", USDC_DECIMALS),
      ethers.parseUnits("400", USDC_DECIMALS)
    );

    expect(quote.premium).to.be.gt(0);
    expect(quote.spotPrice).to.equal(ethers.parseEther("320"));

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(
      HK_0700,
      false,
      ethers.parseUnits("1200", USDC_DECIMALS),
      12 * 3600,
      500,
      ethers.parseUnits("10", USDC_DECIMALS),
      ethers.parseUnits("400", USDC_DECIMALS)
    );

    const policy = await policyFactory.getPolicy(1);
    expect(policy.symbol).to.equal(HK_0700);
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
    const { owner, pricingOracle, oracleAdapter } = await loadFixture(deployFixture);
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const amznSpotFeed = await MockPriceFeed.deploy(178n * 10n ** 8n, 8, owner.address);
    await amznSpotFeed.waitForDeployment();

    await oracleAdapter.configureFeed(ethers.encodeBytes32String("AMZN"), {
      primaryFeed: await amznSpotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(ethers.encodeBytes32String("AMZN"), {
      minDuration: 3600,
      maxDuration: 30 * 24 * 3600,
      basePremiumBps: 155,
      maxNotional: ethers.parseUnits("50000", USDC_DECIMALS),
      minTriggerBps: 500,
      maxTriggerBps: 2000,
      openMinutesLocal: 570,
      closeMinutesLocal: 960,
      closeBufferMinutes: 15,
      overnightGapSurchargeBps: 120,
      enforceMarketHours: false,
      calendarType: CALENDAR_US,
      allowFallbackOracle: true,
      settlementMode: SETTLEMENT_MODE_NEXT_OPEN,
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

  it("respects US market hours in both standard time and daylight saving time", async function () {
    const { owner, pricingOracle, baseConfig, oracleAdapter } = await loadFixture(deployFixture);
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const amdSpotFeed = await MockPriceFeed.deploy(120n * 10n ** 8n, 8, owner.address);
    await amdSpotFeed.waitForDeployment();

    await oracleAdapter.configureFeed(ethers.encodeBytes32String("AMD"), {
      primaryFeed: await amdSpotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(ethers.encodeBytes32String("AMD"), {
      ...baseConfig,
      enforceMarketHours: true
    });

    await time.increaseTo(utcTimestamp(2026, 6, 15, 13, 0));
    expect(await pricingOracle.isMarketOpen(ethers.encodeBytes32String("AMD"))).to.equal(false);

    await time.increaseTo(utcTimestamp(2026, 6, 15, 14, 0));
    expect(await pricingOracle.isMarketOpen(ethers.encodeBytes32String("AMD"))).to.equal(true);

    await time.increaseTo(utcTimestamp(2026, 11, 15, 14, 0));
    expect(await pricingOracle.isMarketOpen(ethers.encodeBytes32String("AMD"))).to.equal(false);

    await time.increaseTo(utcTimestamp(2026, 11, 15, 15, 0));
    expect(await pricingOracle.isMarketOpen(ethers.encodeBytes32String("AMD"))).to.equal(true);
  });

  it("respects Hong Kong market hours and blocks buying outside the HKT session", async function () {
    const { lp, buyer, mockUsdc, insuranceVault, policyFactory, pricingOracle } = await loadFixture(deployFixture);
    const hkNotional = ethers.parseUnits("1000", USDC_DECIMALS);
    const hkPayoutCap = ethers.parseUnits("500", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, ethers.parseUnits("10000", USDC_DECIMALS));

    await time.increaseTo(utcTimestamp(2026, 6, 15, 0, 30));
    expect(await pricingOracle.isMarketOpen(HK_0700)).to.equal(false);
    await expect(
      policyFactory.previewPolicy(HK_0700, true, hkNotional, 24 * 3600, 1000, 0, hkPayoutCap)
    ).to.be.revertedWithCustomError(pricingOracle, "MarketClosed");

    await time.increaseTo(utcTimestamp(2026, 6, 15, 1, 45));
    expect(await pricingOracle.isMarketOpen(HK_0700)).to.equal(true);

    const quote = await policyFactory.previewPolicy(HK_0700, true, hkNotional, 24 * 3600, 1000, 0, hkPayoutCap);
    expect(quote.premium).to.be.gt(0);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(HK_0700, true, hkNotional, 24 * 3600, 1000, 0, hkPayoutCap);

    const policy = await policyFactory.getPolicy(1);
    expect(policy.symbol).to.equal(HK_0700);
  });

  it("treats the Hong Kong lunch recess as a closed window and reopens at 13:00 HKT", async function () {
    const { pricingOracle, policyFactory } = await loadFixture(deployFixture);
    const hkNotional = ethers.parseUnits("1000", USDC_DECIMALS);
    const hkPayoutCap = ethers.parseUnits("500", USDC_DECIMALS);

    await time.increaseTo(utcTimestamp(2026, 6, 15, 2, 30));
    expect(await pricingOracle.isMarketOpen(HK_0700)).to.equal(true);

    const morningSession = await pricingOracle.getSessionWindow(HK_0700, utcTimestamp(2026, 6, 15, 2, 30));
    expect(morningSession.isOpen).to.equal(true);
    expect(morningSession.closeTimestamp).to.equal(utcTimestamp(2026, 6, 15, 4, 0));
    expect(morningSession.nextOpenTimestamp).to.equal(utcTimestamp(2026, 6, 15, 5, 0));

    await time.increaseTo(utcTimestamp(2026, 6, 15, 4, 30));
    expect(await pricingOracle.isMarketOpen(HK_0700)).to.equal(false);

    const lunchSession = await pricingOracle.getSessionWindow(HK_0700, utcTimestamp(2026, 6, 15, 4, 30));
    expect(lunchSession.isOpen).to.equal(false);
    expect(lunchSession.nextOpenTimestamp).to.equal(utcTimestamp(2026, 6, 15, 5, 0));

    await expect(
      policyFactory.previewPolicy(HK_0700, true, hkNotional, 24 * 3600, 1000, 0, hkPayoutCap)
    ).to.be.revertedWithCustomError(pricingOracle, "MarketClosed");

    await time.increaseTo(utcTimestamp(2026, 6, 15, 6, 0));
    expect(await pricingOracle.isMarketOpen(HK_0700)).to.equal(true);

    const afternoonSession = await pricingOracle.getSessionWindow(HK_0700, utcTimestamp(2026, 6, 15, 6, 0));
    expect(afternoonSession.isOpen).to.equal(true);
    expect(afternoonSession.openTimestamp).to.equal(utcTimestamp(2026, 6, 15, 5, 0));
    expect(afternoonSession.closeTimestamp).to.equal(utcTimestamp(2026, 6, 15, 8, 0));
  });

  it("treats configured US holidays as closed market days", async function () {
    const { pricingOracle, policyFactory, baseConfig, oracleAdapter } = await loadFixture(deployFixture);
    const IBM = ethers.encodeBytes32String("IBM");
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const ibmSpotFeed = await MockPriceFeed.deploy(250n * 10n ** 8n, 8, (await ethers.getSigners())[0].address);
    await ibmSpotFeed.waitForDeployment();

    await oracleAdapter.configureFeed(IBM, {
      primaryFeed: await ibmSpotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(IBM, {
      ...baseConfig,
      enforceMarketHours: true
    });
    await pricingOracle.setCalendarClosure(CALENDAR_US, 20260703, true);

    await time.increaseTo(utcTimestamp(2026, 6, 3, 14, 0));
    expect(await pricingOracle.isMarketOpen(IBM)).to.equal(false);
    await expect(
      policyFactory.previewPolicy(
        IBM,
        true,
        ethers.parseUnits("1000", USDC_DECIMALS),
        24 * 3600,
        1000,
        0,
        ethers.parseUnits("500", USDC_DECIMALS)
      )
    ).to.be.revertedWithCustomError(pricingOracle, "MarketClosed");
  });

  it("blocks new policies too close to the close and adds overnight gap surcharge across sessions", async function () {
    const { pricingOracle, policyFactory, baseConfig, oracleAdapter } = await loadFixture(deployFixture);
    const ORCL = ethers.encodeBytes32String("ORCL");
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const orclSpotFeed = await MockPriceFeed.deploy(145n * 10n ** 8n, 8, (await ethers.getSigners())[0].address);
    await orclSpotFeed.waitForDeployment();

    await oracleAdapter.configureFeed(ORCL, {
      primaryFeed: await orclSpotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(ORCL, {
      ...baseConfig,
      enforceMarketHours: true
    });
    const riskProvider = await ethers.getContractAt(
      "MockRiskParameterProvider",
      await pricingOracle.riskParameterProvider()
    );
    await riskProvider.setRiskSnapshot(
      ORCL,
      riskSnapshot({
        impliedVolBps: 2600,
        downsideSkewBps: 110,
        upsideSkewBps: 85,
        shortTermMultiplierBps: 10100,
        mediumTermMultiplierBps: 9950,
        longTermMultiplierBps: 9700,
        downsideInventoryPressureBps: 70,
        upsideInventoryPressureBps: 45,
        stressPremiumBps: 45,
        riskScoreBps: 5800,
        sourceTag: "TEST_ORCL"
      })
    );

    await time.increaseTo(utcTimestamp(2026, 6, 15, 14, 0));
    const intradayQuote = await policyFactory.previewPolicy(
      ORCL,
      true,
      ethers.parseUnits("1000", USDC_DECIMALS),
      2 * 3600,
      1000,
      0,
      ethers.parseUnits("500", USDC_DECIMALS)
    );
    const overnightQuote = await policyFactory.previewPolicy(
      ORCL,
      true,
      ethers.parseUnits("1000", USDC_DECIMALS),
      24 * 3600,
      1000,
      0,
      ethers.parseUnits("500", USDC_DECIMALS)
    );

    expect(intradayQuote.overnightGapSurchargeBps).to.equal(0);
    expect(overnightQuote.overnightGapSurchargeBps).to.equal(120);

    await time.increaseTo(utcTimestamp(2026, 6, 15, 19, 50));
    await expect(
      policyFactory.previewPolicy(
        ORCL,
        true,
        ethers.parseUnits("1000", USDC_DECIMALS),
        2 * 3600,
        1000,
        0,
        ethers.parseUnits("500", USDC_DECIMALS)
      )
    ).to.be.revertedWithCustomError(pricingOracle, "MarketClosingSoon");
  });

  it("settles after hours policies on the next market open window", async function () {
    const { lp, buyer, mockUsdc, spotFeed, pricingOracle, insuranceVault, policyFactory, baseConfig, oracleAdapter } =
      await loadFixture(deployFixture);

    await oracleAdapter.configureFeed(AAPL, {
      primaryFeed: await spotFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(AAPL, {
      ...baseConfig,
      enforceMarketHours: true,
      settlementMode: SETTLEMENT_MODE_NEXT_OPEN
    });

    const lpDeposit = ethers.parseUnits("10000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("500", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    await time.increaseTo(utcTimestamp(2026, 6, 15, 17, 0));
    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 8 * 3600, 1000, 0, payoutCap);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 8 * 3600, 1000, 0, payoutCap);

    const policy = await policyFactory.getPolicy(1);
    await spotFeed.setAnswer(150n * 10n ** 8n);

    await time.increaseTo(Number(policy.expiry) + 1);
    await expect(policyFactory.settlePolicy(1)).to.be.revertedWithCustomError(
      pricingOracle,
      "SettlementPricePending"
    );

    await time.increaseTo(Number(quote.effectiveSettlementTime) + 1);
    await policyFactory.settlePolicy(1);

    const settledPolicy = await policyFactory.getPolicy(1);
    expect(settledPolicy.status).to.equal(1);
    expect(settledPolicy.exitPrice).to.equal(ethers.parseEther("150"));
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

  it("uses fallback oracle data when the primary feed is stale", async function () {
    const { owner, pricingOracle, policyFactory, oracleAdapter, baseConfig } = await loadFixture(deployFixture);
    const META = ethers.encodeBytes32String("META");
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const primaryFeed = await MockPriceFeed.deploy(600n * 10n ** 8n, 8, owner.address);
    const fallbackFeed = await MockPriceFeed.deploy(590n * 10n ** 8n, 8, owner.address);
    await primaryFeed.waitForDeployment();
    await fallbackFeed.waitForDeployment();

    await primaryFeed.setAnswerWithTimestamp(600n * 10n ** 8n, 1);
    await fallbackFeed.setAnswerWithTimestamp(590n * 10n ** 8n, await time.latest());

    await oracleAdapter.configureFeed(META, {
      primaryFeed: await primaryFeed.getAddress(),
      fallbackFeed: await fallbackFeed.getAddress(),
      maxStaleness: 24 * 3600,
      isActive: true
    });
    await pricingOracle.configureMarket(META, {
      ...baseConfig,
      basePremiumBps: 165
    });

    const riskProvider = await ethers.getContractAt(
      "MockRiskParameterProvider",
      await pricingOracle.riskParameterProvider()
    );
    await riskProvider.setRiskSnapshot(
      META,
      riskSnapshot({
        impliedVolBps: 3100,
        downsideSkewBps: 130,
        upsideSkewBps: 95,
        shortTermMultiplierBps: 10300,
        mediumTermMultiplierBps: 10050,
        longTermMultiplierBps: 9700,
        downsideInventoryPressureBps: 75,
        upsideInventoryPressureBps: 50,
        stressPremiumBps: 50,
        riskScoreBps: 6000,
        sourceTag: "TEST_META"
      })
    );

    const quote = await policyFactory.previewPolicy(
      META,
      true,
      ethers.parseUnits("1000", USDC_DECIMALS),
      24 * 3600,
      1000,
      0,
      ethers.parseUnits("500", USDC_DECIMALS)
    );

    expect(quote.oracleUsedFallback).to.equal(true);
    expect(quote.spotPrice).to.equal(ethers.parseEther("590"));
  });

  it("automation keeper finds and settles ready policies", async function () {
    const { lp, buyer, mockUsdc, spotFeed, insuranceVault, policyFactory, settlementAutomation } =
      await loadFixture(deployFixture);

    const lpDeposit = ethers.parseUnits("10000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("500", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);
    await policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

    await spotFeed.setAnswer(120n * 10n ** 8n);
    const purchasedPolicy = await policyFactory.getPolicy(1);
    await time.increaseTo(Number(purchasedPolicy.expiry) + 1);

    const [upkeepNeeded, performData] = await settlementAutomation.checkUpkeep("0x");
    expect(upkeepNeeded).to.equal(true);

    await settlementAutomation.performUpkeep(performData);

    const settledPolicy = await policyFactory.getPolicy(1);
    expect(settledPolicy.status).to.equal(1);
    expect(await policyFactory.getActivePoliciesCount()).to.equal(0);
  });

  it("enforces per-symbol exposure caps", async function () {
    const { owner, lp, buyer, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);
    const lpDeposit = ethers.parseUnits("10000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("600", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    await policyFactory.connect(owner).setSymbolExposureLimit(AAPL, ethers.parseUnits("500", USDC_DECIMALS));

    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);
    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);

    await expect(
      policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap)
    ).to.be.revertedWithCustomError(policyFactory, "SymbolExposureLimitExceeded");
  });

  it("enforces downside and upside direction caps", async function () {
    const { owner, lp, buyer, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);
    const lpDeposit = ethers.parseUnits("10000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("500", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    await policyFactory.connect(owner).configureRiskLimits(
      9000,
      8500,
      0,
      ethers.parseUnits("400", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS)
    );

    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);
    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);

    await expect(
      policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap)
    ).to.be.revertedWithCustomError(policyFactory, "DirectionExposureLimitExceeded");
  });

  it("enforces term bucket exposure caps", async function () {
    const { owner, lp, buyer, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);
    const lpDeposit = ethers.parseUnits("10000", USDC_DECIMALS);
    const notional = ethers.parseUnits("1000", USDC_DECIMALS);
    const payoutCap = ethers.parseUnits("500", USDC_DECIMALS);

    await approveAndDeposit(mockUsdc, insuranceVault, lp, lpDeposit);
    await policyFactory.connect(owner).configureRiskLimits(
      9000,
      8500,
      0,
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("400", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS)
    );

    const quote = await policyFactory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);
    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);

    await expect(
      policyFactory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap)
    ).to.be.revertedWithCustomError(policyFactory, "TermBucketExposureLimitExceeded");
  });

  it("supports manual underwriting pause", async function () {
    const { owner, buyer, policyFactory } = await loadFixture(deployFixture);
    await policyFactory.connect(owner).setUnderwritingPaused(true, ethers.encodeBytes32String("MANUAL"));

    await expect(
      policyFactory.connect(buyer).purchasePolicy(
        AAPL,
        true,
        ethers.parseUnits("1000", USDC_DECIMALS),
        24 * 3600,
        1000,
        0,
        ethers.parseUnits("500", USDC_DECIMALS)
      )
    ).to.be.revertedWithCustomError(policyFactory, "EnforcedPause");
  });

  it("separates governor, risk, oracle, and pauser duties", async function () {
    const { buyer, riskManager, oracleManager, pauser, pricingOracle, policyFactory } = await loadFixture(deployFixture);

    await policyFactory.connect(riskManager).setSymbolExposureLimit(AAPL, ethers.parseUnits("750", USDC_DECIMALS));
    expect(await policyFactory.symbolExposureLimit(AAPL)).to.equal(ethers.parseUnits("750", USDC_DECIMALS));

    await pricingOracle.connect(pauser).pauseQuoting();
    await expect(
      pricingOracle.quotePremium(
        AAPL,
        ethers.parseUnits("1000", USDC_DECIMALS),
        24 * 3600,
        1000,
        0,
        ethers.parseUnits("500", USDC_DECIMALS),
        0,
        true
      )
    ).to.be.revertedWithCustomError(pricingOracle, "EnforcedPause");
    await pricingOracle.unpauseQuoting();

    await pricingOracle.connect(oracleManager).setRiskParameterProvider(oracleManager.address);
    expect(await pricingOracle.riskParameterProvider()).to.equal(oracleManager.address);

    await expect(
      policyFactory.connect(buyer).setSymbolExposureLimit(AAPL, ethers.parseUnits("1000", USDC_DECIMALS))
    ).to.be.reverted;
  });

  it("auto-pauses underwriting when utilization is already extreme", async function () {
    const { owner, lp, buyer, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);
    await policyFactory.connect(owner).configureRiskLimits(
      9000,
      5600,
      0,
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS)
    );

    await approveAndDeposit(mockUsdc, insuranceVault, lp, ethers.parseUnits("10000", USDC_DECIMALS));
    const largeQuote = await policyFactory.previewPolicy(
      AAPL,
      true,
      ethers.parseUnits("10000", USDC_DECIMALS),
      24 * 3600,
      1000,
      0,
      ethers.parseUnits("8500", USDC_DECIMALS)
    );
    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), largeQuote.premium);
    await policyFactory.connect(buyer).purchasePolicy(
      AAPL,
      true,
      ethers.parseUnits("10000", USDC_DECIMALS),
      24 * 3600,
      1000,
      0,
      ethers.parseUnits("8500", USDC_DECIMALS)
    );

    const nextQuote = await policyFactory.previewPolicy(
      AAPL,
      true,
      ethers.parseUnits("1000", USDC_DECIMALS),
      24 * 3600,
      1000,
      0,
      ethers.parseUnits("500", USDC_DECIMALS)
    );
    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), nextQuote.premium);

    await expect(
      policyFactory.connect(buyer).purchasePolicy(
        AAPL,
        true,
        ethers.parseUnits("1000", USDC_DECIMALS),
        24 * 3600,
        1000,
        0,
        ethers.parseUnits("500", USDC_DECIMALS)
      )
    ).to.be.revertedWithCustomError(policyFactory, "UnderwritingPaused");
  });

  it("fails solvency checks when the post-trade liquidity buffer would be violated", async function () {
    const { owner, lp, buyer, mockUsdc, insuranceVault, policyFactory } = await loadFixture(deployFixture);
    await approveAndDeposit(mockUsdc, insuranceVault, lp, ethers.parseUnits("10000", USDC_DECIMALS));
    await policyFactory.connect(owner).configureRiskLimits(
      9000,
      8500,
      ethers.parseUnits("9900", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS),
      ethers.parseUnits("1000000", USDC_DECIMALS)
    );

    const quote = await policyFactory.previewPolicy(
      AAPL,
      true,
      ethers.parseUnits("1000", USDC_DECIMALS),
      24 * 3600,
      1000,
      0,
      ethers.parseUnits("500", USDC_DECIMALS)
    );
    await mockUsdc.connect(buyer).approve(await insuranceVault.getAddress(), quote.premium);

    await expect(
      policyFactory.connect(buyer).purchasePolicy(
        AAPL,
        true,
        ethers.parseUnits("1000", USDC_DECIMALS),
        24 * 3600,
        1000,
        0,
        ethers.parseUnits("500", USDC_DECIMALS)
      )
    ).to.be.revertedWithCustomError(policyFactory, "SolvencyCheckFailed");
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
