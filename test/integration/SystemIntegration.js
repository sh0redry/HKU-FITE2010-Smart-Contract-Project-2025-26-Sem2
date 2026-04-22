const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("System Integration", function () {
  const AAPL = ethers.encodeBytes32String("AAPL");
  const TSLA = ethers.encodeBytes32String("TSLA");

  async function deployFixture() {
    const [owner, lp, buyerA, buyerB] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const MockRiskParameterProvider = await ethers.getContractFactory("MockRiskParameterProvider");
    const ChainlinkOracleAdapter = await ethers.getContractFactory("ChainlinkOracleAdapter");
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const PricingOracle = await ethers.getContractFactory("PricingOracle");
    const InsuranceVault = await ethers.getContractFactory("InsuranceVault");
    const PolicyFactory = await ethers.getContractFactory("PolicyFactory");
    const Automation = await ethers.getContractFactory("PolicySettlementAutomation");

    const token = await MockUSDC.deploy(owner.address);
    const riskProvider = await MockRiskParameterProvider.deploy(owner.address);
    const adapter = await ChainlinkOracleAdapter.deploy(owner.address);
    const aaplFeed = await MockPriceFeed.deploy(185n * 10n ** 8n, 8, owner.address);
    const tslaFeed = await MockPriceFeed.deploy(172n * 10n ** 8n, 8, owner.address);
    const oracle = await PricingOracle.deploy(owner.address, await riskProvider.getAddress(), await adapter.getAddress());
    const vault = await InsuranceVault.deploy(owner.address, await token.getAddress());
    const factory = await PolicyFactory.deploy(owner.address, await vault.getAddress(), await oracle.getAddress());
    const automation = await Automation.deploy(await factory.getAddress(), 10);

    for (const contract of [token, riskProvider, adapter, aaplFeed, tslaFeed, oracle, vault, factory, automation]) {
      await contract.waitForDeployment();
    }

    const config = {
      minDuration: 3600,
      maxDuration: 30 * 24 * 3600,
      basePremiumBps: 150,
      maxNotional: ethers.parseUnits("50000", 6),
      minTriggerBps: 500,
      maxTriggerBps: 2000,
      openMinutesLocal: 570,
      closeMinutesLocal: 960,
      closeBufferMinutes: 15,
      overnightGapSurchargeBps: 120,
      enforceMarketHours: false,
      allowFallbackOracle: true,
      settlementMode: 0,
      calendarType: 1,
      isActive: true
    };

    await adapter.configureFeed(AAPL, {
      primaryFeed: await aaplFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await adapter.configureFeed(TSLA, {
      primaryFeed: await tslaFeed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await oracle.configureMarket(AAPL, config);
    await oracle.configureMarket(TSLA, { ...config, basePremiumBps: 190 });

    const risk = (sourceTag, impliedVolBps) => ({
      impliedVolBps,
      downsideSkewBps: 120,
      upsideSkewBps: 90,
      shortTermMultiplierBps: 10250,
      mediumTermMultiplierBps: 10000,
      longTermMultiplierBps: 9650,
      downsideInventoryPressureBps: 80,
      upsideInventoryPressureBps: 45,
      stressPremiumBps: 55,
      riskScoreBps: 6200,
      updatedAt: Math.floor(Date.now() / 1000),
      sourceTag: ethers.encodeBytes32String(sourceTag)
    });
    await riskProvider.setRiskSnapshot(AAPL, risk("AAPL", 2800));
    await riskProvider.setRiskSnapshot(TSLA, risk("TSLA", 4200));
    await vault.setPolicyManager(await factory.getAddress());

    const lpDeposit = ethers.parseUnits("20000", 6);
    await token.mint(lp.address, lpDeposit);
    await token.mint(buyerA.address, ethers.parseUnits("10000", 6));
    await token.mint(buyerB.address, ethers.parseUnits("10000", 6));
    await token.connect(lp).approve(await vault.getAddress(), lpDeposit);
    await vault.connect(lp).deposit(lpDeposit);

    return { owner, lp, buyerA, buyerB, token, aaplFeed, tslaFeed, vault, factory, automation };
  }

  it("settles multiple policies and clears aggregate exposures", async function () {
    const { buyerA, buyerB, token, aaplFeed, tslaFeed, vault, factory, automation } = await loadFixture(deployFixture);

    const aaplQuote = await factory.previewPolicy(AAPL, true, ethers.parseUnits("1000", 6), 24 * 3600, 1000, 0, ethers.parseUnits("500", 6));
    const tslaQuote = await factory.previewPolicy(TSLA, false, ethers.parseUnits("1200", 6), 24 * 3600, 1000, 0, ethers.parseUnits("550", 6));

    await token.connect(buyerA).approve(await vault.getAddress(), ethers.MaxUint256);
    await token.connect(buyerB).approve(await vault.getAddress(), ethers.MaxUint256);
    await factory.connect(buyerA).purchasePolicy(AAPL, true, ethers.parseUnits("1000", 6), 24 * 3600, 1000, 0, ethers.parseUnits("500", 6));
    await factory.connect(buyerB).purchasePolicy(TSLA, false, ethers.parseUnits("1200", 6), 24 * 3600, 1000, 0, ethers.parseUnits("550", 6));

    await aaplFeed.setAnswer(120n * 10n ** 8n);
    await tslaFeed.setAnswer(210n * 10n ** 8n);
    const policyA = await factory.getPolicy(1);
    await time.increaseTo(Number(policyA.expiry) + 1);

    const [needed, performData] = await automation.checkUpkeep("0x");
    expect(needed).to.equal(true);
    await automation.performUpkeep(performData);

    expect(await factory.getActivePoliciesCount()).to.equal(0);
    expect(await factory.downsideExposure()).to.equal(0);
    expect(await factory.upsideExposure()).to.equal(0);
    expect(await vault.totalReserved()).to.equal(0);
  });
});
