import { MARKET_SCENARIOS } from "./scenarios.js";

let runtimeConfigPromise = null;

async function loadRuntimeConfig() {
  if (!window.location.protocol.startsWith("http")) {
    return null;
  }

  if (!runtimeConfigPromise) {
    runtimeConfigPromise = fetch("./runtime-config.json")
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
  }

  return runtimeConfigPromise;
}

function alphaSymbolFor(deployment, symbol) {
  return deployment?.markets?.[symbol]?.alphaVantageSymbol || symbol;
}

function yfinanceSymbolFor(deployment, symbol) {
  return deployment?.markets?.[symbol]?.yfinanceSymbol || symbol;
}

function mockCandles() {
  const scenario = MARKET_SCENARIOS.MOCK || [];
  return scenario.map((point, index) => {
    const previous = scenario[Math.max(index - 1, 0)]?.price ?? point.price;
    const open = previous;
    const close = point.price;
    const high = Math.max(open, close) * 1.015;
    const low = Math.min(open, close) * 0.985;
    return { time: point.date, open, high, low, close };
  });
}

async function fetchAlphaVantageCandles(symbol, deployment) {
  const runtimeConfig = await loadRuntimeConfig();
  if (!runtimeConfig?.alphaVantageApiKey) {
    throw new Error("runtime-config.json is missing ALPHA_VANTAGE_API_KEY.");
  }

  const alphaSymbol = alphaSymbolFor(deployment, symbol);
  if (alphaSymbol === "MOCK") {
    return mockCandles();
  }

  const query = new URLSearchParams({
    function: "TIME_SERIES_INTRADAY",
    interval: "5min",
    outputsize: "compact",
    symbol: alphaSymbol,
    apikey: runtimeConfig.alphaVantageApiKey
  });

  const response = await fetch(`${runtimeConfig.alphaVantageBaseUrl}?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Market data request failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  if (data.Note) {
    throw new Error(`Alpha Vantage rate limit: ${data.Note}`);
  }
  if (data["Error Message"]) {
    throw new Error(`Alpha Vantage error for ${alphaSymbol}.`);
  }

  const series = data["Time Series (5min)"];
  if (!series) {
    throw new Error(`No intraday candles available for ${alphaSymbol}.`);
  }

  return Object.entries(series)
    .map(([time, candle]) => ({
      time,
      open: Number(candle["1. open"]),
      high: Number(candle["2. high"]),
      low: Number(candle["3. low"]),
      close: Number(candle["4. close"])
    }))
    .sort((left, right) => left.time.localeCompare(right.time))
    .slice(-48);
}

async function fetchYfinanceCandles(symbol, deployment) {
  const runtimeConfig = await loadRuntimeConfig();
  const yfinanceSymbol = yfinanceSymbolFor(deployment, symbol);
  if (yfinanceSymbol === "MOCK") {
    return mockCandles();
  }

  const query = new URLSearchParams({
    interval: "5m",
    range: "1d",
    includePrePost: "false",
    events: "div,splits"
  });

  const response = await fetch(`${runtimeConfig?.yfinanceChartBaseUrl || "https://query1.finance.yahoo.com/v8/finance/chart"}/${encodeURIComponent(yfinanceSymbol)}?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Yahoo Finance request failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const error = data?.chart?.error;
  if (error) {
    throw new Error(`Yahoo Finance error: ${error.description || error.code}`);
  }
  if (!result) {
    throw new Error(`No intraday candles available for ${yfinanceSymbol}.`);
  }

  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0];
  if (!quote || timestamps.length === 0) {
    throw new Error(`No intraday candles available for ${yfinanceSymbol}.`);
  }

  return timestamps
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
        close
      };
    })
    .filter(Boolean)
    .slice(-48);
}

export async function fetchMarketCandles(symbol, deployment) {
  if (symbol === "MOCK") {
    return mockCandles();
  }

  const runtimeConfig = await loadRuntimeConfig();
  const provider = (runtimeConfig?.marketDataProvider || "yfinance").toLowerCase();

  if (provider === "alpha-vantage") {
    return fetchAlphaVantageCandles(symbol, deployment);
  }

  return fetchYfinanceCandles(symbol, deployment);
}

export function drawCandlestickChart(canvas, candles, title) {
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#2d2115";
  ctx.fillRect(0, 0, width, height);

  if (!candles || candles.length === 0) {
    ctx.fillStyle = "#fdf2e4";
    ctx.font = "14px sans-serif";
    ctx.fillText("No intraday candles loaded.", 16, 28);
    return;
  }

  const maxPrice = Math.max(...candles.map((candle) => candle.high));
  const minPrice = Math.min(...candles.map((candle) => candle.low));
  const priceRange = Math.max(maxPrice - minPrice, 0.0001);
  const candleWidth = Math.max(((width - 60) / candles.length) * 0.55, 3);
  const xStep = (width - 60) / candles.length;

  const toY = (price) => 24 + ((maxPrice - price) / priceRange) * (height - 52);

  ctx.fillStyle = "#fdf2e4";
  ctx.font = "13px sans-serif";
  ctx.fillText(title, 16, 18);
  ctx.fillText(`High ${maxPrice.toFixed(2)}`, width - 130, 18);
  ctx.fillText(`Low ${minPrice.toFixed(2)}`, width - 130, height - 12);

  candles.forEach((candle, index) => {
    const x = 30 + index * xStep + xStep / 2;
    const openY = toY(candle.open);
    const closeY = toY(candle.close);
    const highY = toY(candle.high);
    const lowY = toY(candle.low);
    const isUp = candle.close >= candle.open;

    ctx.strokeStyle = isUp ? "#6ec28b" : "#de7c2d";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    ctx.fillStyle = isUp ? "#6ec28b" : "#de7c2d";
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
    ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
  });
}

export function summarizeCandles(candles) {
  if (!candles || candles.length === 0) {
    return "No live candles loaded.";
  }

  const first = candles[0];
  const last = candles[candles.length - 1];
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const movePct = ((last.close - first.open) / first.open) * 100;

  return [
    `bars: ${candles.length}`,
    `from: ${first.time}`,
    `to: ${last.time}`,
    `open: ${first.open.toFixed(2)}`,
    `last: ${last.close.toFixed(2)}`,
    `high: ${high.toFixed(2)}`,
    `low: ${low.toFixed(2)}`,
    `move: ${movePct.toFixed(2)}%`
  ].join(" | ");
}

export async function getRefreshIntervalMs() {
  const runtimeConfig = await loadRuntimeConfig();
  return runtimeConfig?.refreshIntervalMs || 60000;
}
