const fs = require("fs");
const path = require("path");

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";
const YFINANCE_CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

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

function resolveMarketDataProvider() {
  loadLocalEnv();
  return (process.env.MARKET_DATA_PROVIDER || "yfinance").trim().toLowerCase();
}

function resolveAlphaVantageApiKey() {
  loadLocalEnv();
  return process.env.ALPHA_VANTAGE_API_KEY || "";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function alphaVantageGet(params) {
  const apiKey = resolveAlphaVantageApiKey();
  if (!apiKey) {
    throw new Error("Missing ALPHA_VANTAGE_API_KEY. Set it in your shell or .env file.");
  }

  const query = new URLSearchParams({ ...params, apikey: apiKey });
  const response = await fetch(`${ALPHA_VANTAGE_BASE}?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Alpha Vantage request failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data["Error Message"]) {
    throw new Error(`Alpha Vantage error: ${data["Error Message"]}`);
  }
  if (data.Note) {
    throw new Error(`Alpha Vantage rate limit: ${data.Note}`);
  }

  return data;
}

async function yahooChartGet(symbol, params) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${YFINANCE_CHART_BASE}/${encodeURIComponent(symbol)}?${query.toString()}`, {
    headers: {
      "User-Agent": "StockHedgeInsurance/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance request failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const error = data?.chart?.error;
  if (error) {
    throw new Error(`Yahoo Finance error: ${error.description || error.code}`);
  }
  if (!result) {
    throw new Error(`No Yahoo Finance chart result returned for ${symbol}.`);
  }

  return result;
}

async function fetchAlphaVantageDailySeries(symbol) {
  const data = await alphaVantageGet({
    function: "TIME_SERIES_DAILY",
    outputsize: "compact",
    symbol
  });

  const series = data["Time Series (Daily)"];
  if (!series) {
    throw new Error(`No daily price series returned for ${symbol}.`);
  }

  return Object.entries(series)
    .map(([date, candle]) => ({
      date,
      open: Number(candle["1. open"]),
      high: Number(candle["2. high"]),
      low: Number(candle["3. low"]),
      close: Number(candle["4. close"]),
      volume: Number(candle["5. volume"])
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchYahooDailySeries(symbol) {
  const result = await yahooChartGet(symbol, {
    interval: "1d",
    range: "3mo",
    includePrePost: "false",
    events: "div,splits"
  });

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) {
    throw new Error(`No Yahoo Finance daily candles returned for ${symbol}.`);
  }

  const series = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const open = Number(quote.open?.[index]);
    const high = Number(quote.high?.[index]);
    const low = Number(quote.low?.[index]);
    const close = Number(quote.close?.[index]);
    const volume = Number(quote.volume?.[index] || 0);
    if (!Number.isFinite(close) || close <= 0) {
      continue;
    }

    const isoDate = new Date(timestamps[index] * 1000).toISOString().slice(0, 10);
    series.push({
      date: isoDate,
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
      volume
    });
  }

  return series;
}

async function fetchDailySeries(provider, symbol) {
  if (provider === "alpha-vantage") {
    return fetchAlphaVantageDailySeries(symbol);
  }
  if (provider === "yfinance") {
    return fetchYahooDailySeries(symbol);
  }

  throw new Error(`Unsupported market data provider: ${provider}`);
}

function computeAnnualizedVolBps(series, windowSize = 20) {
  const closes = series.slice(-windowSize - 1).map((entry) => entry.close);
  if (closes.length < 3) {
    return 2500;
  }

  const logReturns = [];
  for (let index = 1; index < closes.length; index += 1) {
    logReturns.push(Math.log(closes[index] / closes[index - 1]));
  }

  const mean = logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length;
  const variance =
    logReturns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) /
    Math.max(logReturns.length - 1, 1);

  const annualized = Math.sqrt(variance) * Math.sqrt(252);
  return clamp(Math.round(annualized * 10000), 1200, 9000);
}

function buildRiskSnapshot(ethers, symbol, series, provider) {
  const latest = series[series.length - 1];
  const previous = series[series.length - 2] || latest;
  const annualVolBps = computeAnnualizedVolBps(series, 20);
  const trendBps = previous.close === 0 ? 0 : Math.round(((latest.close - previous.close) / previous.close) * 10000);
  const downsideBias = trendBps < 0 ? Math.abs(trendBps) : Math.floor(Math.abs(trendBps) / 2);
  const upsideBias = trendBps > 0 ? Math.abs(trendBps) : Math.floor(Math.abs(trendBps) / 2);
  const riskScoreBps = clamp(4200 + annualVolBps + Math.floor((Math.abs(trendBps) * 3) / 2), 4800, 9000);
  const providerTag = provider === "yfinance" ? "YFINANCE" : "ALPHA";
  const sourceTag = symbol.endsWith("HK") ? `${providerTag}_HK` : `${providerTag}_US`;

  return {
    latestClose: latest.close,
    latestDate: latest.date,
    annualVolBps,
    snapshot: {
      impliedVolBps: annualVolBps,
      downsideSkewBps: clamp(80 + Math.floor(annualVolBps / 80) + downsideBias, 90, 320),
      upsideSkewBps: clamp(70 + Math.floor(annualVolBps / 100) + upsideBias, 80, 260),
      shortTermMultiplierBps: clamp(10000 + Math.floor(annualVolBps / 30), 10050, 11200),
      mediumTermMultiplierBps: clamp(9950 + Math.floor(annualVolBps / 55), 9950, 10750),
      longTermMultiplierBps: clamp(9600 + Math.floor(annualVolBps / 75), 9650, 10350),
      downsideInventoryPressureBps: clamp(45 + Math.floor(annualVolBps / 55), 55, 180),
      upsideInventoryPressureBps: clamp(30 + Math.floor(annualVolBps / 75), 35, 130),
      stressPremiumBps: clamp(25 + Math.floor(annualVolBps / 60), 35, 130),
      riskScoreBps,
      updatedAt: Math.floor(Date.now() / 1000),
      sourceTag: ethers.encodeBytes32String(sourceTag)
    }
  };
}

module.exports = {
  resolveMarketDataProvider,
  resolveAlphaVantageApiKey,
  fetchDailySeries,
  buildRiskSnapshot
};
