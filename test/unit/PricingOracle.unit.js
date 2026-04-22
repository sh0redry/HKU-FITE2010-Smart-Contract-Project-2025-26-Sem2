const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("PricingOracle Unit", function () {
  const USDC_DECIMALS = 6;
  const AAPL = ethers.encodeBytes32String("AAPL");

  async function deployFixture() {
    const [owner] = await ethers.getSigners();

    const MockRiskParameterProvider = await ethers.getContractFactory("MockRiskParameterProvider");
    const ChainlinkOracleAdapter = await ethers.getContractFactory("ChainlinkOracleAdapter");
    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const PricingOracle = await ethers.getContractFactory("PricingOracle");

    const riskProvider = await MockRiskParameterProvider.deploy(owner.address);
    const adapter = await ChainlinkOracleAdapter.deploy(owner.address);
    const primary = await MockPriceFeed.deploy(185n * 10n ** 8n, 8, owner.address);
    const fallback = await MockPriceFeed.deploy(182n * 10n ** 8n, 8, owner.address);

    await riskProvider.waitForDeployment();
    await adapter.waitForDeployment();
    await primary.waitForDeployment();
    await fallback.waitForDeployment();

    const oracle = await PricingOracle.deploy(owner.address, await riskProvider.getAddress(), await adapter.getAddress());
    await oracle.waitForDeployment();

    await adapter.configureFeed(AAPL, {
      primaryFeed: await primary.getAddress(),
      fallbackFeed: await fallback.getAddress(),
      maxStaleness: 24 * 3600,
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
      sourceTag: ethers.encodeBytes32String("UNIT")
    });

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
      allowFallbackOracle: true,
      settlementMode: 0,
      calendarType: 1,
      isActive: true
    };
    await oracle.configureMarket(AAPL, baseConfig);

    return { oracle, primary, fallback, baseConfig };
  }

  it("rejects invalid payout term combinations", async function () {
    const { oracle } = await deployFixture();
    await expect(
      oracle.quotePremium(AAPL, ethers.parseUnits("1000", 6), 24 * 3600, 1000, ethers.parseUnits("600", 6), ethers.parseUnits("500", 6), 0, true)
    ).to.be.revertedWithCustomError(oracle, "InvalidPayoutTerms");
  });

  it("rejects fallback responses when fallback usage is disabled", async function () {
    const { oracle, primary, fallback, baseConfig } = await deployFixture();

    await primary.setAnswerWithTimestamp(185n * 10n ** 8n, 1);
    await fallback.setAnswerWithTimestamp(182n * 10n ** 8n, await time.latest());
    await oracle.configureMarket(AAPL, {
      ...baseConfig,
      allowFallbackOracle: false
    });

    await expect(
      oracle.quotePremium(AAPL, ethers.parseUnits("1000", 6), 24 * 3600, 1000, 0, ethers.parseUnits("500", 6), 0, true)
    ).to.be.revertedWithCustomError(oracle, "FallbackOracleDisabled");
  });
});
