const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const [owner, lp, buyer] = await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const MockRiskParameterProvider = await ethers.getContractFactory("MockRiskParameterProvider");
  const ChainlinkOracleAdapter = await ethers.getContractFactory("ChainlinkOracleAdapter");
  const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
  const PricingOracle = await ethers.getContractFactory("PricingOracle");
  const InsuranceVault = await ethers.getContractFactory("InsuranceVault");
  const PolicyFactory = await ethers.getContractFactory("PolicyFactory");

  const mockUsdc = await MockUSDC.deploy(owner.address);
  await mockUsdc.waitForDeployment();
  const riskProvider = await MockRiskParameterProvider.deploy(owner.address);
  await riskProvider.waitForDeployment();
  const adapter = await ChainlinkOracleAdapter.deploy(owner.address);
  await adapter.waitForDeployment();
  const spotFeed = await MockPriceFeed.deploy(185n * 10n ** 8n, 8, owner.address);
  await spotFeed.waitForDeployment();
  const oracle = await PricingOracle.deploy(owner.address, await riskProvider.getAddress(), await adapter.getAddress());
  await oracle.waitForDeployment();
  const vault = await InsuranceVault.deploy(owner.address, await mockUsdc.getAddress());
  await vault.waitForDeployment();
  const factory = await PolicyFactory.deploy(owner.address, await vault.getAddress(), await oracle.getAddress());
  await factory.waitForDeployment();

  const AAPL = ethers.encodeBytes32String("AAPL");
  await adapter.configureFeed(AAPL, {
    primaryFeed: await spotFeed.getAddress(),
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
    sourceTag: ethers.encodeBytes32String("GAS_REPORT")
  });
  await vault.setPolicyManager(await factory.getAddress());

  const lpDeposit = ethers.parseUnits("10000", 6);
  const notional = ethers.parseUnits("1000", 6);
  const payoutCap = ethers.parseUnits("500", 6);

  await mockUsdc.mint(lp.address, lpDeposit + ethers.parseUnits("1000", 6));
  await mockUsdc.mint(buyer.address, ethers.parseUnits("5000", 6));
  await mockUsdc.connect(lp).approve(await vault.getAddress(), lpDeposit);
  await vault.connect(lp).deposit(lpDeposit);

  const quote = await factory.previewPolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);
  await mockUsdc.connect(buyer).approve(await vault.getAddress(), quote.premium);

  const purchaseGas = await factory.connect(buyer).purchasePolicy.estimateGas(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);
  await factory.connect(buyer).purchasePolicy(AAPL, true, notional, 24 * 3600, 1000, 0, payoutCap);

  await mockUsdc.connect(lp).approve(await vault.getAddress(), ethers.MaxUint256);
  const depositGas = await vault.connect(lp).deposit.estimateGas(ethers.parseUnits("100", 6));
  const withdrawGas = await vault.connect(lp).withdraw.estimateGas(ethers.parseUnits("100", 6));

  const report = {
    network: hre.network.name,
    estimates: {
      purchasePolicy: purchaseGas.toString(),
      deposit: depositGas.toString(),
      withdraw: withdrawGas.toString()
    }
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
