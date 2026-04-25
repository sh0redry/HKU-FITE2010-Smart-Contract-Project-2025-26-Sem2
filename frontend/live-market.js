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

function proxyPathFor(runtimeConfig) {
  return runtimeConfig?.marketDataProxyPath || "/api/market-candles";
}

function alphaSymbolFor(deployment, symbol) {
  return deployment?.markets?.[symbol]?.alphaVantageSymbol || symbol;
}

function yfinanceSymbolFor(deployment, symbol) {
  return deployment?.markets?.[symbol]?.yfinanceSymbol || symbol;
}

function defaultYfinanceSymbol(symbol) {
  const upper = String(symbol || "").toUpperCase();
  if (upper === "MOCK") return "MOCK";
  if (upper.endsWith("HK")) {
    const raw = upper.replace("HK", "");
    const padded = raw.padStart(4, "0");
    return `${padded}.HK`;
  }
  return upper;
}

function scenarioCandlesFor(symbol) {
  const scenario = MARKET_SCENARIOS[symbol] || [];
  if (scenario.length === 0) return [];
  return scenario.map((point, index) => {
    const previous = scenario[Math.max(index - 1, 0)]?.price ?? point.price;
    const drift = Math.max(point.price * 0.012, 0.05);
    const open = previous;
    const close = point.price;
    const high = Math.max(open, close) + drift;
    const low = Math.max(0.01, Math.min(open, close) - drift);
    return { time: point.date, open, high, low, close, source: "scenario-fallback" };
  });
}

function mockCandles() {
  return scenarioCandlesFor("MOCK");
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
    provider: "alpha-vantage",
    symbol: alphaSymbol,
    range: "1week"
  });

  const response = await fetch(`${proxyPathFor(runtimeConfig)}?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Market data request failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }

  return Array.isArray(data.candles) ? data.candles : [];
}

async function fetchYfinanceCandles(symbol, deployment) {
  const runtimeConfig = await loadRuntimeConfig();
  const mappedFromDeployment = yfinanceSymbolFor(deployment, symbol);
  const normalizedFallback = defaultYfinanceSymbol(symbol);
  const candidates = [...new Set([mappedFromDeployment, normalizedFallback].filter(Boolean))];
  if (candidates.includes("MOCK")) {
    return mockCandles();
  }

  let lastError = null;
  for (const yfinanceSymbol of candidates) {
    try {
      const query = new URLSearchParams({
        provider: "yfinance",
        symbol: yfinanceSymbol,
        range: "1week"
      });
      const response = await fetch(`${proxyPathFor(runtimeConfig)}?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Yahoo Finance request failed with HTTP ${response.status}.`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      const candles = Array.isArray(data.candles) ? data.candles : [];

      if (candles.length > 0) {
        return candles;
      }
      throw new Error(`No valid intraday candles parsed for ${yfinanceSymbol}.`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`No intraday candles available for ${symbol}.`);
}

export async function fetchMarketCandles(symbol, deployment) {
  if (symbol === "MOCK") {
    return mockCandles();
  }

  const runtimeConfig = await loadRuntimeConfig();
  const provider = (runtimeConfig?.marketDataProvider || "yfinance").toLowerCase();

  try {
    if (provider === "alpha-vantage") {
      return await fetchAlphaVantageCandles(symbol, deployment);
    }
    return await fetchYfinanceCandles(symbol, deployment);
  } catch (primaryError) {
    try {
      if (provider === "alpha-vantage") {
        return await fetchYfinanceCandles(symbol, deployment);
      }
      return await fetchAlphaVantageCandles(symbol, deployment);
    } catch {
      const scenarioFallback = scenarioCandlesFor(symbol);
      if (scenarioFallback.length > 0) {
        return scenarioFallback;
      }
      throw primaryError;
    }
  }
}

export function drawCandlestickChart(canvas, candles, title) {
  if (!canvas) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  if (!candles || candles.length === 0) {
    ctx.fillStyle = "rgba(106,140,176,0.55)";
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText(title || "No intraday candles loaded.", 16, 28);
    return;
  }

  const maxPrice = Math.max(...candles.map((candle) => candle.high));
  const minPrice = Math.min(...candles.map((candle) => candle.low));
  const priceRange = Math.max(maxPrice - minPrice, 0.0001);
  const padL = 52, padR = 20, padT = 22, padB = 20;
  const drawW = width - padL - padR;
  const drawH = height - padT - padB;
  const candleWidth = Math.max((drawW / candles.length) * 0.55, 2);
  const xStep = drawW / candles.length;

  const toY = (price) => padT + ((maxPrice - price) / priceRange) * drawH;

  // Grid
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  for (let g = 0; g <= 3; g++) {
    const y = padT + (g / 3) * drawH;
    const price = maxPrice - (g / 3) * (maxPrice - minPrice);
    ctx.strokeStyle = "rgba(55,130,255,0.1)";
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(width - padR, y); ctx.stroke();
    ctx.fillStyle = "rgba(106,140,176,0.7)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`$${price.toFixed(2)}`, padL - 4, y + 3);
  }
  ctx.setLineDash([]);
  ctx.textAlign = "start";

  // Title / stats
  ctx.fillStyle = "rgba(184,212,242,0.8)";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(title, padL, 14);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(0,196,140,0.85)";
  ctx.fillText(`H $${maxPrice.toFixed(2)}`, width - padR, 14);
  ctx.fillStyle = "rgba(247,75,103,0.85)";
  ctx.fillText(`L $${minPrice.toFixed(2)}`, width - padR, height - 4);
  ctx.textAlign = "start";

  candles.forEach((candle, index) => {
    const x = padL + index * xStep + xStep / 2;
    const openY  = toY(candle.open);
    const closeY = toY(candle.close);
    const highY  = toY(candle.high);
    const lowY   = toY(candle.low);
    const isUp   = candle.close >= candle.open;

    // Wick
    ctx.strokeStyle = isUp ? "rgba(0,196,140,0.8)" : "rgba(247,75,103,0.8)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    // Body
    ctx.fillStyle = isUp ? "rgba(0,196,140,0.85)" : "rgba(247,75,103,0.85)";
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
    ctx.beginPath();
    ctx.roundRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight, 1);
    ctx.fill();
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
    `move: ${movePct.toFixed(2)}%`,
    candles.some((candle) => candle.source === "scenario-fallback")
      ? "source: local scenario fallback"
      : candles.some((candle) => candle.source === "proxy-yfinance")
        ? "source: yfinance via local proxy"
        : candles.some((candle) => candle.source === "proxy-alpha-vantage")
          ? "source: alpha vantage via local proxy"
          : "source: live"
  ].join(" | ");
}

export async function getRefreshIntervalMs() {
  const runtimeConfig = await loadRuntimeConfig();
  return runtimeConfig?.refreshIntervalMs || 60000;
}
