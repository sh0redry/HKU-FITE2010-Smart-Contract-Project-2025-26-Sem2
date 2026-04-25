const fs = require("fs");
const path = require("path");

function loadLocalEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function main() {
  loadLocalEnv();

  const runtimeConfig = {
    marketDataProvider: process.env.MARKET_DATA_PROVIDER || "yfinance",
    alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || "",
    alphaVantageBaseUrl: "https://www.alphavantage.co/query",
    yfinanceChartBaseUrl: "https://query1.finance.yahoo.com/v8/finance/chart",
    marketDataProxyPath: "/api/market-candles",
    syncMarketPriceProxyPath: "/api/sync-market-price",
    refreshIntervalMs: 60000
  };

  const outputPath = path.join(__dirname, "..", "frontend", "runtime-config.json");
  fs.writeFileSync(outputPath, JSON.stringify(runtimeConfig, null, 2));
  console.log(`Wrote runtime config to ${outputPath}`);
}

main();
