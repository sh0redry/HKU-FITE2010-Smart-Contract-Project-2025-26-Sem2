const fs = require("fs");
const path = require("path");

const { resolveMarketDataProvider, fetchDailySeries, buildRiskSnapshot } = require("./market-data-utils");

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return "";
  }
  return process.argv[index + 1];
}

function resolveDeploymentFile() {
  const requested = getArgValue("--deployment");
  if (requested) {
    return path.isAbsolute(requested) ? requested : path.join(process.cwd(), requested);
  }

  return path.join(__dirname, "..", "frontend", "deployments", "localhost.json");
}

async function main() {
  const hre = require("hardhat");
  const { ethers } = hre;
  const deploymentFile = resolveDeploymentFile();
  const symbolFilter = getArgValue("--symbol").trim().toUpperCase();
  const provider = resolveMarketDataProvider();

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`Deployment file not found: ${deploymentFile}`);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const mockFeed = await ethers.getContractFactory("MockPriceFeed");
  const riskProvider = await ethers.getContractAt(
    "MockRiskParameterProvider",
    deployment.contracts.riskParameterProvider
  );

  const selectedEntries = Object.entries(deployment.markets)
    .filter(([symbol, market]) => market.alphaVantageSymbol && market.alphaVantageSymbol !== "MOCK")
    .filter(([symbol]) => !symbolFilter || symbol === symbolFilter);

  if (selectedEntries.length === 0) {
    throw new Error("No live markets matched the requested filters.");
  }

  for (const [symbol, market] of selectedEntries) {
    const remoteSymbol =
      provider === "yfinance"
        ? (market.yfinanceSymbol || symbol)
        : (market.alphaVantageSymbol || symbol);
    const series = await fetchDailySeries(provider, remoteSymbol);
    const { latestClose, latestDate, annualVolBps, snapshot } = buildRiskSnapshot(ethers, symbol, series, provider);
    const feed = mockFeed.attach(market.spotFeed);
    const scaledPrice = BigInt(Math.round(latestClose * 1e8));

    console.log(
      `[sync] ${symbol} <- ${provider}:${remoteSymbol} close ${latestClose} on ${latestDate}, vol ${annualVolBps} bps`
    );
    await (await feed.setAnswer(scaledPrice)).wait();
    await (await riskProvider.setRiskSnapshot(ethers.encodeBytes32String(symbol), snapshot)).wait();
  }

  console.log(`[sync] Updated ${selectedEntries.length} market(s) from ${provider}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
