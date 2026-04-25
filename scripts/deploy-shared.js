const fs = require("fs");
const path = require("path");

const SETTLEMENT_MODE_CURRENT = 0;
const SETTLEMENT_MODE_NEXT_OPEN = 1;
const CALENDAR_US = 1;
const CALENDAR_HK = 2;

function riskSnapshot(ethers, {
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

function marketSeedDataForEnv(ethers, deployer, getFeedFactory, envLabel) {
  // Local and demo are presentation environments: keep quoting available 24/7.
  // Testnet keeps realistic market-hour enforcement.
  const isPresentationEnv = envLabel === "demo" || envLabel === "local";
  const hkHours = isPresentationEnv ? false : true;
  const usHours = isPresentationEnv ? false : true;
  const sourceUs = envLabel === "testnet" ? "CHAINLINK_TN" : "CHAINLINK_FN";
  const sourceHk = envLabel === "testnet" ? "HK_TN" : "HK_FN";

  return {
    AAPL: {
      createFeed: () => getFeedFactory().deploy(185n * 10n ** 8n, 8, deployer.address),
      yfinanceSymbol: "AAPL",
      alphaVantageSymbol: "AAPL",
      basePremiumBps: 150,
      calendarType: CALENDAR_US,
      enforceMarketHours: usHours,
      riskSnapshot: riskSnapshot(ethers, {
        impliedVolBps: 2800, downsideSkewBps: 120, upsideSkewBps: 90, shortTermMultiplierBps: 10250,
        mediumTermMultiplierBps: 10000, longTermMultiplierBps: 9650, downsideInventoryPressureBps: 80,
        upsideInventoryPressureBps: 45, stressPremiumBps: 55, riskScoreBps: 6200, sourceTag: sourceUs
      })
    },
    TSLA: {
      createFeed: () => getFeedFactory().deploy(172n * 10n ** 8n, 8, deployer.address),
      yfinanceSymbol: "TSLA",
      alphaVantageSymbol: "TSLA",
      basePremiumBps: 190,
      calendarType: CALENDAR_US,
      enforceMarketHours: usHours,
      riskSnapshot: riskSnapshot(ethers, {
        impliedVolBps: 4200, downsideSkewBps: 180, upsideSkewBps: 140, shortTermMultiplierBps: 10800,
        mediumTermMultiplierBps: 10300, longTermMultiplierBps: 9800, downsideInventoryPressureBps: 130,
        upsideInventoryPressureBps: 90, stressPremiumBps: 85, riskScoreBps: 7600, sourceTag: sourceUs
      })
    },
    NVDA: {
      createFeed: () => getFeedFactory().deploy(890n * 10n ** 8n, 8, deployer.address),
      yfinanceSymbol: "NVDA",
      alphaVantageSymbol: "NVDA",
      basePremiumBps: 175,
      calendarType: CALENDAR_US,
      enforceMarketHours: usHours,
      riskSnapshot: riskSnapshot(ethers, {
        impliedVolBps: 3600, downsideSkewBps: 150, upsideSkewBps: 120, shortTermMultiplierBps: 10550,
        mediumTermMultiplierBps: 10150, longTermMultiplierBps: 9750, downsideInventoryPressureBps: 110,
        upsideInventoryPressureBps: 70, stressPremiumBps: 70, riskScoreBps: 7100, sourceTag: sourceUs
      })
    },
    MSFT: {
      createFeed: () => getFeedFactory().deploy(415n * 10n ** 8n, 8, deployer.address),
      yfinanceSymbol: "MSFT",
      alphaVantageSymbol: "MSFT",
      basePremiumBps: 135,
      calendarType: CALENDAR_US,
      enforceMarketHours: usHours,
      riskSnapshot: riskSnapshot(ethers, {
        impliedVolBps: 2100, downsideSkewBps: 100, upsideSkewBps: 85, shortTermMultiplierBps: 10150,
        mediumTermMultiplierBps: 9950, longTermMultiplierBps: 9700, downsideInventoryPressureBps: 60,
        upsideInventoryPressureBps: 35, stressPremiumBps: 40, riskScoreBps: 5400, sourceTag: sourceUs
      })
    },
    "0700HK": {
      createFeed: () => getFeedFactory().deploy(320n * 10n ** 8n, 8, deployer.address),
      yfinanceSymbol: "0700.HK",
      alphaVantageSymbol: "0700.HKG",
      basePremiumBps: 160,
      calendarType: CALENDAR_HK,
      enforceMarketHours: hkHours,
      riskSnapshot: riskSnapshot(ethers, {
        impliedVolBps: 2600, downsideSkewBps: 115, upsideSkewBps: 90, shortTermMultiplierBps: 10180,
        mediumTermMultiplierBps: 9980, longTermMultiplierBps: 9720, downsideInventoryPressureBps: 70,
        upsideInventoryPressureBps: 45, stressPremiumBps: 48, riskScoreBps: 5900, sourceTag: sourceHk
      })
    },
    "9988HK": {
      createFeed: () => getFeedFactory().deploy(92n * 10n ** 8n, 8, deployer.address),
      yfinanceSymbol: "9988.HK",
      alphaVantageSymbol: "9988.HKG",
      basePremiumBps: 170,
      calendarType: CALENDAR_HK,
      enforceMarketHours: hkHours,
      riskSnapshot: riskSnapshot(ethers, {
        impliedVolBps: 3000, downsideSkewBps: 135, upsideSkewBps: 105, shortTermMultiplierBps: 10350,
        mediumTermMultiplierBps: 10080, longTermMultiplierBps: 9760, downsideInventoryPressureBps: 85,
        upsideInventoryPressureBps: 55, stressPremiumBps: 56, riskScoreBps: 6400, sourceTag: sourceHk
      })
    },
    "0005HK": {
      createFeed: () => getFeedFactory().deploy(64n * 10n ** 8n, 8, deployer.address),
      yfinanceSymbol: "0005.HK",
      alphaVantageSymbol: "0005.HKG",
      basePremiumBps: 140,
      calendarType: CALENDAR_HK,
      enforceMarketHours: hkHours,
      riskSnapshot: riskSnapshot(ethers, {
        impliedVolBps: 2200, downsideSkewBps: 95, upsideSkewBps: 80, shortTermMultiplierBps: 10080,
        mediumTermMultiplierBps: 9920, longTermMultiplierBps: 9680, downsideInventoryPressureBps: 52,
        upsideInventoryPressureBps: 32, stressPremiumBps: 38, riskScoreBps: 5200, sourceTag: sourceHk
      })
    },
    MOCK: {
      createFeed: () => getFeedFactory().deploy(100n * 10n ** 8n, 8, deployer.address),
      yfinanceSymbol: "MOCK",
      alphaVantageSymbol: "MOCK",
      basePremiumBps: 145,
      calendarType: 0,
      enforceMarketHours: false,
      riskSnapshot: riskSnapshot(ethers, {
        impliedVolBps: 3400, downsideSkewBps: 145, upsideSkewBps: 125, shortTermMultiplierBps: 10450,
        mediumTermMultiplierBps: 10180, longTermMultiplierBps: 9900, downsideInventoryPressureBps: 95,
        upsideInventoryPressureBps: 70, stressPremiumBps: 62, riskScoreBps: 6800, sourceTag: "MOCK_DEMO"
      })
    }
  };
}

async function deployStack(hre, options = {}) {
  const { ethers, network } = hre;
  const envLabel = options.envLabel || (network.name === "localhost" ? "local" : "testnet");
  const outputName = options.outputName || `${network.name}.json`;
  const [governor, lp, buyer, riskManager, oracleManager, pauser] = await ethers.getSigners();
  const deployer = governor;

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const MockRiskParameterProvider = await ethers.getContractFactory("MockRiskParameterProvider");
  const ChainlinkOracleAdapter = await ethers.getContractFactory("ChainlinkOracleAdapter");
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const PricingOracle = await ethers.getContractFactory("PricingOracle");
  const InsuranceVault = await ethers.getContractFactory("InsuranceVault");
  const PolicyFactory = await ethers.getContractFactory("PolicyFactory");
  const PolicySettlementAutomation = await ethers.getContractFactory("PolicySettlementAutomation");

  const mockUsdc = await MockUSDC.deploy(deployer.address);
  await mockUsdc.waitForDeployment();

  const riskParameterProvider = await MockRiskParameterProvider.deploy(deployer.address);
  await riskParameterProvider.waitForDeployment();

  const oracleAdapter = await ChainlinkOracleAdapter.deploy(deployer.address);
  await oracleAdapter.waitForDeployment();

  const pricingOracle = await PricingOracle.deploy(
    governor.address,
    await riskParameterProvider.getAddress(),
    await oracleAdapter.getAddress()
  );
  await pricingOracle.waitForDeployment();

  const insuranceVault = await InsuranceVault.deploy(deployer.address, await mockUsdc.getAddress());
  await insuranceVault.waitForDeployment();

  const policyFactory = await PolicyFactory.deploy(
    governor.address,
    await insuranceVault.getAddress(),
    await pricingOracle.getAddress()
  );
  await policyFactory.waitForDeployment();

  const settlementAutomation = await PolicySettlementAutomation.deploy(await policyFactory.getAddress(), 10);
  await settlementAutomation.waitForDeployment();

  await pricingOracle.grantRole(await pricingOracle.RISK_MANAGER_ROLE(), riskManager.address);
  await pricingOracle.grantRole(await pricingOracle.ORACLE_MANAGER_ROLE(), oracleManager.address);
  await pricingOracle.grantRole(await pricingOracle.PAUSER_ROLE(), pauser.address);
  await policyFactory.grantRole(await policyFactory.RISK_MANAGER_ROLE(), riskManager.address);
  await policyFactory.grantRole(await policyFactory.PAUSER_ROLE(), pauser.address);

  const getFeedFactory = () => MockPriceFeed;
  const marketSeedData = marketSeedDataForEnv(ethers, deployer, getFeedFactory, envLabel);

  for (const symbol of Object.keys(marketSeedData)) {
    const feed = await marketSeedData[symbol].createFeed();
    await feed.waitForDeployment();
    marketSeedData[symbol].spot = feed;

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
      primaryFeed: await feed.getAddress(),
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
  const initialLiquidity = ethers.parseUnits(envLabel === "demo" ? "100000" : "200000", 6);

  await mockUsdc.mint(lp.address, lpMint);
  await mockUsdc.mint(buyer.address, buyerMint);
  await mockUsdc.mint(deployer.address, deployerMint);
  await mockUsdc.connect(lp).approve(await insuranceVault.getAddress(), initialLiquidity);
  await insuranceVault.connect(lp).deposit(initialLiquidity);

  const output = {
    network: network.name,
    envLabel,
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
    markets: Object.fromEntries(
      await Promise.all(
        Object.keys(marketSeedData).map(async (symbol) => [
          symbol,
          {
            spotFeed: await marketSeedData[symbol].spot.getAddress(),
            yfinanceSymbol: marketSeedData[symbol].yfinanceSymbol,
            alphaVantageSymbol: marketSeedData[symbol].alphaVantageSymbol,
            enforceMarketHours: marketSeedData[symbol].enforceMarketHours,
            calendarType: marketSeedData[symbol].calendarType,
            riskSnapshot: marketSeedData[symbol].riskSnapshot
          }
        ])
      )
    ),
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
  fs.writeFileSync(path.join(frontendDir, outputName), JSON.stringify(output, null, 2));

  return output;
}

module.exports = {
  deployStack
};
