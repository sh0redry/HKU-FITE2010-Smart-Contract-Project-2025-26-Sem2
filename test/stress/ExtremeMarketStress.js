const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Extreme Market Stress", function () {
  const AAPL = ethers.encodeBytes32String("AAPL");

  async function deployFixture() {
    const [owner, lp, buyer1, buyer2, buyer3] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const MockRiskParameterProvider = await ethers.getContractFactory("MockRiskParameterProvider");
    const ChainlinkOracleAdapter = await ethers.getContractFactory("ChainlinkOracleAdapter");
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const PricingOracle = await ethers.getContractFactory("PricingOracle");
    const InsuranceVault = await ethers.getContractFactory("InsuranceVault");
    const PolicyFactory = await ethers.getContractFactory("PolicyFactory");

    const token = await MockUSDC.deploy(owner.address);
    const riskProvider = await MockRiskParameterProvider.deploy(owner.address);
    const adapter = await ChainlinkOracleAdapter.deploy(owner.address);
    const feed = await MockPriceFeed.deploy(185n * 10n ** 8n, 8, owner.address);
    const oracle = await PricingOracle.deploy(owner.address, await riskProvider.getAddress(), await adapter.getAddress());
    const vault = await InsuranceVault.deploy(owner.address, await token.getAddress());
    const factory = await PolicyFactory.deploy(owner.address, await vault.getAddress(), await oracle.getAddress());

    for (const contract of [token, riskProvider, adapter, feed, oracle, vault, factory]) {
      await contract.waitForDeployment();
    }

    await adapter.configureFeed(AAPL, {
      primaryFeed: await feed.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 365 * 24 * 3600,
      isActive: true
    });
    await oracle.configureMarket(AAPL, {
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
    });
    await riskProvider.setRiskSnapshot(AAPL, {
      impliedVolBps: 6000,
      downsideSkewBps: 220,
      upsideSkewBps: 110,
      shortTermMultiplierBps: 11000,
      mediumTermMultiplierBps: 10600,
      longTermMultiplierBps: 9900,
      downsideInventoryPressureBps: 180,
      upsideInventoryPressureBps: 70,
      stressPremiumBps: 120,
      riskScoreBps: 9000,
      updatedAt: Math.floor(Date.now() / 1000),
      sourceTag: ethers.encodeBytes32String("STRESS")
    });
    await vault.setPolicyManager(await factory.getAddress());
    await token.mint(lp.address, ethers.parseUnits("100000", 6));
    for (const buyer of [buyer1, buyer2, buyer3]) {
      await token.mint(buyer.address, ethers.parseUnits("10000", 6));
    }
    await token.connect(lp).approve(await vault.getAddress(), ethers.parseUnits("100000", 6));
    await vault.connect(lp).deposit(ethers.parseUnits("100000", 6));

    return { buyer1, buyer2, buyer3, token, feed, vault, factory };
  }

  it("stays solvent through a sharp downside move across multiple active policies", async function () {
    const { buyer1, buyer2, buyer3, token, feed, vault, factory } = await loadFixture(deployFixture);
    const buyers = [buyer1, buyer2, buyer3];

    for (const buyer of buyers) {
      const quote = await factory.previewPolicy(AAPL, true, ethers.parseUnits("5000", 6), 24 * 3600, 1500, 0, ethers.parseUnits("1200", 6));
      await token.connect(buyer).approve(await vault.getAddress(), quote.premium);
      await factory.connect(buyer).purchasePolicy(AAPL, true, ethers.parseUnits("5000", 6), 24 * 3600, 1500, 0, ethers.parseUnits("1200", 6));
    }

    await feed.setAnswer(90n * 10n ** 8n);
    const expiries = [];
    for (const id of [1, 2, 3]) {
      const policy = await factory.getPolicy(id);
      expiries.push(Number(policy.expiry));
    }
    await time.increaseTo(Math.max(...expiries) + 1);
    await factory.settlePolicies([1, 2, 3]);

    expect(await vault.totalReserved()).to.equal(0);
    expect(await vault.totalAssets()).to.be.gte(0);
    expect(await factory.getActivePoliciesCount()).to.equal(0);
  });
});
