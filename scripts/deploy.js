const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

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
  const [deployer, lp, buyer] = await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUsdc = await MockUSDC.deploy(deployer.address);
  await mockUsdc.waitForDeployment();

  const MockRiskParameterProvider = await ethers.getContractFactory("MockRiskParameterProvider");
  const riskParameterProvider = await MockRiskParameterProvider.deploy(deployer.address);
  await riskParameterProvider.waitForDeployment();

  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const spotFeed = await MockPriceFeed.deploy(185n * 10n ** 8n, 8, deployer.address);
  await spotFeed.waitForDeployment();

  const PricingOracle = await ethers.getContractFactory("PricingOracle");
  const pricingOracle = await PricingOracle.deploy(deployer.address, await riskParameterProvider.getAddress());
  await pricingOracle.waitForDeployment();

  const InsuranceVault = await ethers.getContractFactory("InsuranceVault");
  const insuranceVault = await InsuranceVault.deploy(deployer.address, await mockUsdc.getAddress());
  await insuranceVault.waitForDeployment();

  const PolicyFactory = await ethers.getContractFactory("PolicyFactory");
  const policyFactory = await PolicyFactory.deploy(
    deployer.address,
    await insuranceVault.getAddress(),
    await pricingOracle.getAddress()
  );
  await policyFactory.waitForDeployment();

  const marketSeedData = {
    AAPL: {
      spot: spotFeed,
      basePremiumBps: 150,
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
    }
  };

  for (const symbol of Object.keys(marketSeedData)) {
    await marketSeedData[symbol].spot.waitForDeployment();

    await pricingOracle.configureMarket(ethers.encodeBytes32String(symbol), {
      spotFeed: await marketSeedData[symbol].spot.getAddress(),
      minDuration: 3600,
      maxDuration: 30 * 24 * 3600,
      basePremiumBps: marketSeedData[symbol].basePremiumBps,
      maxNotional: ethers.parseUnits("50000", 6),
      minTriggerBps: 500,
      maxTriggerBps: 2000,
      openMinutesUtc: 570,
      closeMinutesUtc: 960,
      enforceMarketHours: false,
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
      pricingOracle: await pricingOracle.getAddress(),
      insuranceVault: await insuranceVault.getAddress(),
      policyFactory: await policyFactory.getAddress()
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
      }
    },
    accounts: {
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
