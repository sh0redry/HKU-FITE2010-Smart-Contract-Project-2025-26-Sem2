const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  const [deployer, lp, buyer] = await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUsdc = await MockUSDC.deploy(deployer.address);
  await mockUsdc.waitForDeployment();

  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const spotFeed = await MockPriceFeed.deploy(185n * 10n ** 8n, 8, deployer.address);
  const volFeed = await MockPriceFeed.deploy(2800, 2, deployer.address);
  await Promise.all([spotFeed.waitForDeployment(), volFeed.waitForDeployment()]);

  const PricingOracle = await ethers.getContractFactory("PricingOracle");
  const pricingOracle = await PricingOracle.deploy(deployer.address);
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
    AAPL: { spot: spotFeed, vol: volFeed, basePremiumBps: 150, downsideRiskBps: 120, upsideRiskBps: 90 },
    TSLA: {
      spot: await (await ethers.getContractFactory("MockPriceFeed")).deploy(172n * 10n ** 8n, 8, deployer.address),
      vol: await (await ethers.getContractFactory("MockPriceFeed")).deploy(4200, 2, deployer.address),
      basePremiumBps: 190,
      downsideRiskBps: 180,
      upsideRiskBps: 140
    },
    NVDA: {
      spot: await (await ethers.getContractFactory("MockPriceFeed")).deploy(890n * 10n ** 8n, 8, deployer.address),
      vol: await (await ethers.getContractFactory("MockPriceFeed")).deploy(3600, 2, deployer.address),
      basePremiumBps: 175,
      downsideRiskBps: 150,
      upsideRiskBps: 120
    },
    MSFT: {
      spot: await (await ethers.getContractFactory("MockPriceFeed")).deploy(415n * 10n ** 8n, 8, deployer.address),
      vol: await (await ethers.getContractFactory("MockPriceFeed")).deploy(2100, 2, deployer.address),
      basePremiumBps: 135,
      downsideRiskBps: 100,
      upsideRiskBps: 85
    }
  };

  for (const symbol of Object.keys(marketSeedData)) {
    await marketSeedData[symbol].spot.waitForDeployment();
    await marketSeedData[symbol].vol.waitForDeployment();

    await pricingOracle.configureMarket(ethers.encodeBytes32String(symbol), {
      spotFeed: await marketSeedData[symbol].spot.getAddress(),
      volFeed: await marketSeedData[symbol].vol.getAddress(),
      minDuration: 3600,
      maxDuration: 30 * 24 * 3600,
      basePremiumBps: marketSeedData[symbol].basePremiumBps,
      maxNotional: ethers.parseUnits("50000", 6),
      downsideRiskBps: marketSeedData[symbol].downsideRiskBps,
      upsideRiskBps: marketSeedData[symbol].upsideRiskBps,
      minTriggerBps: 500,
      maxTriggerBps: 2000,
      openMinutesUtc: 570,
      closeMinutesUtc: 960,
      enforceMarketHours: false,
      isActive: true
    });
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
      pricingOracle: await pricingOracle.getAddress(),
      insuranceVault: await insuranceVault.getAddress(),
      policyFactory: await policyFactory.getAddress()
    },
    markets: {
      AAPL: {
        spotFeed: await marketSeedData.AAPL.spot.getAddress(),
        volFeed: await marketSeedData.AAPL.vol.getAddress()
      },
      TSLA: {
        spotFeed: await marketSeedData.TSLA.spot.getAddress(),
        volFeed: await marketSeedData.TSLA.vol.getAddress()
      },
      NVDA: {
        spotFeed: await marketSeedData.NVDA.spot.getAddress(),
        volFeed: await marketSeedData.NVDA.vol.getAddress()
      },
      MSFT: {
        spotFeed: await marketSeedData.MSFT.spot.getAddress(),
        volFeed: await marketSeedData.MSFT.vol.getAddress()
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
