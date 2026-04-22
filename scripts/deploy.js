const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
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

async function main() {
  const [governor, lp, buyer, riskManager, oracleManager, pauser] = await ethers.getSigners();
  const deployer = governor;

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUsdc = await MockUSDC.deploy(deployer.address);
  await mockUsdc.waitForDeployment();

  const MockRiskParameterProvider = await ethers.getContractFactory("MockRiskParameterProvider");
  const riskParameterProvider = await MockRiskParameterProvider.deploy(deployer.address);
  await riskParameterProvider.waitForDeployment();

  const ChainlinkOracleAdapter = await ethers.getContractFactory("ChainlinkOracleAdapter");
  const oracleAdapter = await ChainlinkOracleAdapter.deploy(deployer.address);
  await oracleAdapter.waitForDeployment();

  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const spotFeed = await MockPriceFeed.deploy(185n * 10n ** 8n, 8, deployer.address);
  await spotFeed.waitForDeployment();

  const PricingOracle = await ethers.getContractFactory("PricingOracle");
  const pricingOracle = await PricingOracle.deploy(
    governor.address,
    await riskParameterProvider.getAddress(),
    await oracleAdapter.getAddress()
  );
  await pricingOracle.waitForDeployment();

  const InsuranceVault = await ethers.getContractFactory("InsuranceVault");
  const insuranceVault = await InsuranceVault.deploy(deployer.address, await mockUsdc.getAddress());
  await insuranceVault.waitForDeployment();

  const PolicyFactory = await ethers.getContractFactory("PolicyFactory");
  const policyFactory = await PolicyFactory.deploy(
    governor.address,
    await insuranceVault.getAddress(),
    await pricingOracle.getAddress()
  );
  await policyFactory.waitForDeployment();

  const PolicySettlementAutomation = await ethers.getContractFactory("PolicySettlementAutomation");
  const settlementAutomation = await PolicySettlementAutomation.deploy(await policyFactory.getAddress(), 10);
  await settlementAutomation.waitForDeployment();

  await pricingOracle.grantRole(await pricingOracle.RISK_MANAGER_ROLE(), riskManager.address);
  await pricingOracle.grantRole(await pricingOracle.ORACLE_MANAGER_ROLE(), oracleManager.address);
  await pricingOracle.grantRole(await pricingOracle.PAUSER_ROLE(), pauser.address);
  await policyFactory.grantRole(await policyFactory.RISK_MANAGER_ROLE(), riskManager.address);
  await policyFactory.grantRole(await policyFactory.PAUSER_ROLE(), pauser.address);

  const marketSeedData = {
    AAPL: {
      spot: spotFeed,
      basePremiumBps: 150,
      calendarType: CALENDAR_US,
      enforceMarketHours: true,
      riskSnapshot: riskSnapshot({
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
        sourceTag: "CHAINLINK_FN"
      })
    },
    TSLA: {
      spot: await (await ethers.getContractFactory("MockPriceFeed")).deploy(172n * 10n ** 8n, 8, deployer.address),
      basePremiumBps: 190,
      calendarType: CALENDAR_US,
      enforceMarketHours: true,
      riskSnapshot: riskSnapshot({
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
        sourceTag: "CHAINLINK_FN"
      })
    },
    NVDA: {
      spot: await (await ethers.getContractFactory("MockPriceFeed")).deploy(890n * 10n ** 8n, 8, deployer.address),
      basePremiumBps: 175,
      calendarType: CALENDAR_US,
      enforceMarketHours: true,
      riskSnapshot: riskSnapshot({
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
        sourceTag: "CHAINLINK_FN"
      })
    },
    MSFT: {
      spot: await (await ethers.getContractFactory("MockPriceFeed")).deploy(415n * 10n ** 8n, 8, deployer.address),
      basePremiumBps: 135,
      calendarType: CALENDAR_US,
      enforceMarketHours: true,
      riskSnapshot: riskSnapshot({
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
        sourceTag: "CHAINLINK_FN"
      })
    },
    "0700HK": {
      spot: await (await ethers.getContractFactory("MockPriceFeed")).deploy(320n * 10n ** 8n, 8, deployer.address),
      basePremiumBps: 160,
      calendarType: CALENDAR_HK,
      enforceMarketHours: true,
      riskSnapshot: riskSnapshot({
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
        sourceTag: "HK_FN"
      })
    },
    "9988HK": {
      spot: await (await ethers.getContractFactory("MockPriceFeed")).deploy(92n * 10n ** 8n, 8, deployer.address),
      basePremiumBps: 170,
      calendarType: CALENDAR_HK,
      enforceMarketHours: true,
      riskSnapshot: riskSnapshot({
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
        sourceTag: "HK_FN"
      })
    },
    "0005HK": {
      spot: await (await ethers.getContractFactory("MockPriceFeed")).deploy(64n * 10n ** 8n, 8, deployer.address),
      basePremiumBps: 140,
      calendarType: CALENDAR_HK,
      enforceMarketHours: true,
      riskSnapshot: riskSnapshot({
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
        sourceTag: "HK_FN"
      })
    }
  };

  for (const symbol of Object.keys(marketSeedData)) {
    await marketSeedData[symbol].spot.waitForDeployment();

    await pricingOracle.configureMarket(ethers.encodeBytes32String(symbol), {
      minDuration: 3600,
      maxDuration: 30 * 24 * 3600,
      basePremiumBps: marketSeedData[symbol].basePremiumBps,
      maxNotional: ethers.parseUnits("50000", 6),
      minTriggerBps: 500,
      maxTriggerBps: 2000,
      openMinutesLocal: 570,
      closeMinutesLocal: 960,
      closeBufferMinutes: 15,
      overnightGapSurchargeBps: 120,
      enforceMarketHours: marketSeedData[symbol].enforceMarketHours,
      allowFallbackOracle: true,
      settlementMode: marketSeedData[symbol].calendarType === CALENDAR_US ? SETTLEMENT_MODE_NEXT_OPEN : SETTLEMENT_MODE_CURRENT,
      calendarType: marketSeedData[symbol].calendarType,
      isActive: true
    });

    await oracleAdapter.configureFeed(ethers.encodeBytes32String(symbol), {
      primaryFeed: await marketSeedData[symbol].spot.getAddress(),
      fallbackFeed: ethers.ZeroAddress,
      maxStaleness: 24 * 3600,
      isActive: true
    });
    await riskParameterProvider.setRiskSnapshot(ethers.encodeBytes32String(symbol), marketSeedData[symbol].riskSnapshot);
  }

  await insuranceVault.setPolicyManager(await policyFactory.getAddress());

  const lpMint = ethers.parseUnits("250000", 6);
  const buyerMint = ethers.parseUnits("50000", 6);
  const deployerMint = ethers.parseUnits("100000", 6);
  const initialLiquidity = ethers.parseUnits("200000", 6);

  await mockUsdc.mint(lp.address, lpMint);
  await mockUsdc.mint(buyer.address, buyerMint);
  await mockUsdc.mint(deployer.address, deployerMint);

  await mockUsdc.connect(lp).approve(await insuranceVault.getAddress(), initialLiquidity);
  await insuranceVault.connect(lp).deposit(initialLiquidity);

  const output = {
    network: "localhost",
    symbol: "AAPL",
    contracts: {
      mockUsdc: await mockUsdc.getAddress(),
      riskParameterProvider: await riskParameterProvider.getAddress(),
      oracleAdapter: await oracleAdapter.getAddress(),
      pricingOracle: await pricingOracle.getAddress(),
      insuranceVault: await insuranceVault.getAddress(),
      policyFactory: await policyFactory.getAddress(),
      settlementAutomation: await settlementAutomation.getAddress()
    },
    markets: {
      AAPL: {
        spotFeed: await marketSeedData.AAPL.spot.getAddress(),
        riskSnapshot: marketSeedData.AAPL.riskSnapshot
      },
      TSLA: {
        spotFeed: await marketSeedData.TSLA.spot.getAddress(),
        riskSnapshot: marketSeedData.TSLA.riskSnapshot
      },
      NVDA: {
        spotFeed: await marketSeedData.NVDA.spot.getAddress(),
        riskSnapshot: marketSeedData.NVDA.riskSnapshot
      },
      MSFT: {
        spotFeed: await marketSeedData.MSFT.spot.getAddress(),
        riskSnapshot: marketSeedData.MSFT.riskSnapshot
      },
      "0700HK": {
        spotFeed: await marketSeedData["0700HK"].spot.getAddress(),
        riskSnapshot: marketSeedData["0700HK"].riskSnapshot
      },
      "9988HK": {
        spotFeed: await marketSeedData["9988HK"].spot.getAddress(),
        riskSnapshot: marketSeedData["9988HK"].riskSnapshot
      },
      "0005HK": {
        spotFeed: await marketSeedData["0005HK"].spot.getAddress(),
        riskSnapshot: marketSeedData["0005HK"].riskSnapshot
      }
    },
    accounts: {
      governor: governor.address,
      riskManager: riskManager.address,
      oracleManager: oracleManager.address,
      pauser: pauser.address,
      deployer: deployer.address,
      lp: lp.address,
      buyer: buyer.address
    },
    seededBalances: {
      deployerUsdc: deployerMint.toString(),
      lpUsdc: lpMint.toString(),
      buyerUsdc: buyerMint.toString(),
      initialVaultLiquidity: initialLiquidity.toString()
    }
  };

  const frontendDir = path.join(__dirname, "..", "frontend", "deployments");
  fs.mkdirSync(frontendDir, { recursive: true });
  fs.writeFileSync(path.join(frontendDir, "localhost.json"), JSON.stringify(output, null, 2));

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
