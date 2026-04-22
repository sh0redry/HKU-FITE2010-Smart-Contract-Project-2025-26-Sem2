const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("PolicyFactory Fuzz", function () {
  const AAPL = ethers.encodeBytes32String("AAPL");

  async function deployFixture() {
    const [owner, lp, buyer] = await ethers.getSigners();

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
      updatedAt: Math.floor(Date.now() / 1000),
      sourceTag: ethers.encodeBytes32String("FUZZ")
    });
    await vault.setPolicyManager(await factory.getAddress());
    await token.mint(lp.address, ethers.parseUnits("100000", 6));
    await token.connect(lp).approve(await vault.getAddress(), ethers.parseUnits("100000", 6));
    await vault.connect(lp).deposit(ethers.parseUnits("100000", 6));

    return { owner, buyer, token, vault, factory };
  }

  function sample(seed, min, max) {
    return min + (seed % (max - min + 1));
  }

  it("keeps quoted payout terms inside expected bounds across randomized inputs", async function () {
    const { buyer, token, vault, factory } = await loadFixture(deployFixture);

    for (let seed = 1; seed <= 25; seed += 1) {
      const notional = ethers.parseUnits(String(sample(seed * 91, 500, 5000)), 6);
      const triggerBps = sample(seed * 17, 500, 2000);
      const deductible = ethers.parseUnits(String(sample(seed * 29, 0, 150)), 6);
      const payoutCap = ethers.parseUnits(String(sample(seed * 41, 200, 900)), 6);
      const duration = sample(seed * 53, 1, 24) * 3600;
      const downside = seed % 2 === 0;

      if (payoutCap > notional || deductible >= payoutCap) {
        continue;
      }

      const quote = await factory.previewPolicy(AAPL, downside, notional, duration, triggerBps, deductible, payoutCap);
      expect(quote.premium).to.be.gt(0);
      expect(quote.payoutCap).to.equal(payoutCap);
      expect(quote.deductible).to.equal(deductible);
      expect(quote.strikePrice).to.be.gt(0);

      await token.mint(buyer.address, quote.premium);
      await token.connect(buyer).approve(await vault.getAddress(), quote.premium);
      await factory.connect(buyer).purchasePolicy(AAPL, downside, notional, duration, triggerBps, deductible, payoutCap);

      const policy = await factory.getPolicy(BigInt(seed));
      expect(policy.payoutCap).to.equal(payoutCap);
      expect(policy.deductible).to.equal(deductible);
      expect(policy.premiumPaid).to.equal(quote.premium);
    }
  });
});
