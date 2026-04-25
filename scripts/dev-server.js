const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const https = require("https");
const { ethers } = require("ethers");

const PORT = Number(process.env.PORT || 8080);
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const ENV_PATH = path.join(__dirname, "..", ".env");
const LOCAL_DEPLOYMENT_FILE = path.join(FRONTEND_DIR, "deployments", "localhost.json");
const LOCAL_RPC_URL = process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545";

function loadLocalEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(body);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "application/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: return "text/plain; charset=utf-8";
  }
}

function fetchJson(targetUrl) {
  return new Promise((resolve, reject) => {
    https.get(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 StockHedgeInsuranceDemo/1.0",
        "Accept": "application/json"
      }
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Upstream HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid upstream JSON: ${error.message}`));
        }
      });
    }).on("error", reject);
  });
}

async function getYfinanceCandles(symbol) {
  return getYfinanceCandlesForRange(symbol, "1week");
}

async function getYfinanceCandlesForRange(symbol, rangeMode = "intraday") {
  const isOneWeek = rangeMode === "1week";
  const query = new URLSearchParams({
    interval: isOneWeek ? "30m" : "5m",
    range: isOneWeek ? "5d" : "1d",
    includePrePost: "false",
    events: "div,splits"
  });
  const baseUrl = "https://query1.finance.yahoo.com/v8/finance/chart";
  const data = await fetchJson(`${baseUrl}/${encodeURIComponent(symbol)}?${query.toString()}`);
  const result = data?.chart?.result?.[0];
  const error = data?.chart?.error;
  if (error) {
    throw new Error(`Yahoo Finance error: ${error.description || error.code}`);
  }
  if (!result) {
    throw new Error(`No candles available for ${symbol}.`);
  }

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) {
    throw new Error(`No candles available for ${symbol}.`);
  }

  const candles = timestamps
    .map((timestamp, index) => {
      const open = Number(quote.open?.[index]);
      const high = Number(quote.high?.[index]);
      const low = Number(quote.low?.[index]);
      const close = Number(quote.close?.[index]);
      if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) {
        return null;
      }
      return {
        time: new Date(timestamp * 1000).toLocaleString(),
        open,
        high,
        low,
        close,
        source: "proxy-yfinance"
      };
    })
    .filter(Boolean)
    .slice(-48);

  if (candles.length === 0) {
    throw new Error(`No valid candles parsed for ${symbol}.`);
  }

  return candles;
}

async function getAlphaVantageCandles(symbol, rangeMode = "intraday") {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY is missing in .env.");
  }
  const isOneWeek = rangeMode === "1week";
  const query = new URLSearchParams({
    function: "TIME_SERIES_INTRADAY",
    interval: isOneWeek ? "60min" : "5min",
    outputsize: isOneWeek ? "full" : "compact",
    symbol,
    apikey: apiKey
  });
  const data = await fetchJson(`https://www.alphavantage.co/query?${query.toString()}`);
  if (data.Note) {
    throw new Error(`Alpha Vantage rate limit: ${data.Note}`);
  }
  if (data["Error Message"]) {
    throw new Error(`Alpha Vantage error for ${symbol}.`);
  }
  const series = data["Time Series (5min)"];
  if (!series) {
    throw new Error(`No candles available for ${symbol}.`);
  }

  return Object.entries(series)
    .map(([time, candle]) => ({
      time,
      open: Number(candle["1. open"]),
      high: Number(candle["2. high"]),
      low: Number(candle["3. low"]),
      close: Number(candle["4. close"]),
      source: "proxy-alpha-vantage"
    }))
    .sort((left, right) => left.time.localeCompare(right.time))
    .slice(isOneWeek ? -80 : -48);
}

function loadDeploymentMetadata() {
  if (!fs.existsSync(LOCAL_DEPLOYMENT_FILE)) {
    throw new Error(`Deployment file not found: ${LOCAL_DEPLOYMENT_FILE}`);
  }
  return JSON.parse(fs.readFileSync(LOCAL_DEPLOYMENT_FILE, "utf8"));
}

async function rpcRequest(method, params) {
  const response = await fetch(LOCAL_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params
    })
  });
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || `RPC error in ${method}`);
  }
  return payload.result;
}

async function waitForReceipt(txHash, attempts = 20, delayMs = 250) {
  for (let index = 0; index < attempts; index += 1) {
    const receipt = await rpcRequest("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

async function syncLatestMarketPrice(symbol, provider = "yfinance") {
  const deployment = loadDeploymentMetadata();
  const market = deployment.markets?.[symbol];
  if (!market) {
    throw new Error(`Unsupported symbol: ${symbol}`);
  }
  if (symbol === "MOCK") {
    throw new Error("MOCK uses local scenario playback and should not be synced from live data.");
  }

  const remoteSymbol =
    provider === "alpha-vantage"
      ? (market.alphaVantageSymbol || symbol)
      : (market.yfinanceSymbol || symbol);

  const candles = provider === "alpha-vantage"
    ? await getAlphaVantageCandles(remoteSymbol, "1week")
    : await getYfinanceCandlesForRange(remoteSymbol, "1week");

  const latest = candles[candles.length - 1];
  if (!latest || !Number.isFinite(latest.close) || latest.close <= 0) {
    throw new Error(`No latest close available for ${symbol}.`);
  }

  const scaledPrice = BigInt(Math.round(latest.close * 1e8));
  const iface = new ethers.Interface(["function setAnswer(int256 newAnswer)"]);
  const txHash = await rpcRequest("eth_sendTransaction", [{
    from: deployment.accounts?.deployer,
    to: market.spotFeed,
    data: iface.encodeFunctionData("setAnswer", [scaledPrice.toString()])
  }]);

  await waitForReceipt(txHash);

  return {
    symbol,
    provider,
    remoteSymbol,
    feedAddress: market.spotFeed,
    latestClose: latest.close,
    latestTime: latest.time,
    txHash
  };
}

async function handleMarketCandles(reqUrl, res) {
  const provider = (reqUrl.searchParams.get("provider") || "yfinance").toLowerCase();
  const symbol = reqUrl.searchParams.get("symbol");
  const rangeMode = (reqUrl.searchParams.get("range") || "intraday").toLowerCase();
  if (!symbol) {
    sendJson(res, 400, { error: "Missing symbol query parameter." });
    return;
  }

  try {
    const candles = provider === "alpha-vantage"
      ? await getAlphaVantageCandles(symbol, rangeMode)
      : await getYfinanceCandlesForRange(symbol, rangeMode);
    sendJson(res, 200, { provider, symbol, range: rangeMode, candles });
  } catch (error) {
    sendJson(res, 502, { error: error.message });
  }
}

async function handleSyncMarketPrice(reqUrl, res) {
  const provider = (reqUrl.searchParams.get("provider") || "yfinance").toLowerCase();
  const symbol = String(reqUrl.searchParams.get("symbol") || "").trim().toUpperCase();
  if (!symbol) {
    sendJson(res, 400, { error: "Missing symbol query parameter." });
    return;
  }

  try {
    const result = await syncLatestMarketPrice(symbol, provider);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 502, { error: error.message });
  }
}

function handleStatic(reqUrl, res) {
  const requestedPath = reqUrl.pathname === "/" ? "/index.html" : reqUrl.pathname;
  const safeRelativePath = path.normalize(requestedPath).replace(/^(\.\.[\\/])+/, "");
  const filePath = path.join(FRONTEND_DIR, safeRelativePath);
  if (!filePath.startsWith(FRONTEND_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

loadLocalEnv();

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (reqUrl.pathname === "/api/market-candles") {
    await handleMarketCandles(reqUrl, res);
    return;
  }

  if (reqUrl.pathname === "/api/sync-market-price") {
    await handleSyncMarketPrice(reqUrl, res);
    return;
  }

  handleStatic(reqUrl, res);
});

server.listen(PORT, () => {
  console.log(`Demo server running at http://127.0.0.1:${PORT}`);
  console.log(`Buyer: http://127.0.0.1:${PORT}/index.html`);
  console.log(`Admin: http://127.0.0.1:${PORT}/admin.html`);
  console.log(`Simulator: http://127.0.0.1:${PORT}/simulation.html`);
});
