import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";
import {
  policyFactoryAbi,
  vaultAbi,
  oracleAbi,
  erc20Abi,
  policyFactoryInterface,
  vaultInterface,
  oracleInterface,
  erc20Interface,
  decodeBytes32,
  decodeError,
  detectNetwork,
  loadDeploymentByChain,
  policyStatusLabel
} from "./shared.js";
import { drawCandlestickChart, fetchMarketCandles, summarizeCandles, getRefreshIntervalMs } from "./live-market.js";
import { MARKET_CONFIGS, MARKET_SCENARIOS } from "./scenarios.js";

// ── State ──────────────────────────────────────────────────
const state = {
  provider: null,
  signer: null,
  account: null,
  tokenDecimals: 6,
  tokenSymbol: "USDC",
  network: null,
  deployment: null,
  deploymentFile: null,
  contracts: {},
  lastQuote: null,
  lastQuoteMode: "none",
  lastPolicies: [],
  liveChartTimer: null
};

let runtimeConfigPromise = null;

const STATUS_COLORS = {
  Active:    "#00c48c",
  Expired:   "#f7a825",
  Settled:   "#0052ff",
  Cancelled: "#6a8cb0"
};

// ── DOM references ──────────────────────────────────────────
const el = {
  connectButton:        document.getElementById("connectButton"),
  presetUsButton:       document.getElementById("presetUsButton"),
  presetHkButton:       document.getElementById("presetHkButton"),
  presetMockButton:     document.getElementById("presetMockButton"),
  walletStatus:         document.getElementById("walletStatus"),
  networkBadge:         document.getElementById("networkBadge"),
  contractStatus:       document.getElementById("contractStatus"),
  deploymentStatus:     document.getElementById("deploymentStatus"),
  txFeedback:           document.getElementById("txFeedback"),
  saveAddressesButton:  document.getElementById("saveAddressesButton"),
  policyFactoryAddress: document.getElementById("policyFactoryAddress"),
  vaultAddress:         document.getElementById("vaultAddress"),
  oracleAddress:        document.getElementById("oracleAddress"),
  symbolInput:          document.getElementById("symbolInput"),
  notionalInput:        document.getElementById("notionalInput"),
  durationInput:        document.getElementById("durationInput"),
  directionInput:       document.getElementById("directionInput"),
  triggerInput:         document.getElementById("triggerInput"),
  deductibleInput:      document.getElementById("deductibleInput"),
  payoutCapInput:       document.getElementById("payoutCapInput"),
  quoteButton:          document.getElementById("quoteButton"),
  syncMarketPriceButton: document.getElementById("syncMarketPriceButton"),
  buyButton:            document.getElementById("buyButton"),
  quoteOutput:          document.getElementById("quoteOutput"),
  quoteKpis:            document.getElementById("quoteKpis"),
  quoteBreakdownChart:  document.getElementById("quoteBreakdownChart"),
  quoteBreakdownLegend: document.getElementById("quoteBreakdownLegend"),
  priceRiskChart:       document.getElementById("priceRiskChart"),
  livePriceChart:       document.getElementById("livePriceChart"),
  liveChartStatus:      document.getElementById("liveChartStatus"),
  settlePolicyIdInput:  document.getElementById("settlePolicyIdInput"),
  settleButton:         document.getElementById("settleButton"),
  cancelPolicyIdInput:  document.getElementById("cancelPolicyIdInput"),
  cancelButton:         document.getElementById("cancelButton"),
  loadPoliciesButton:   document.getElementById("loadPoliciesButton"),
  policiesStatusOutput: document.getElementById("policiesStatusOutput"),  // unique ID for status
  policiesOutput:       document.getElementById("policiesOutput"),         // unique ID for JSON dump
  policySummary:        document.getElementById("policySummary"),
  policiesTableBody:    document.getElementById("policiesTableBody"),
  vaultUtilSection:     document.getElementById("vaultUtilSection"),
  utilPct:              document.getElementById("utilPct"),
  utilBar:              document.getElementById("utilBar"),
  depositInput:         document.getElementById("depositInput"),
  depositButton:        document.getElementById("depositButton"),
  withdrawInput:        document.getElementById("withdrawInput"),
  withdrawButton:       document.getElementById("withdrawButton"),
  vaultStateButton:     document.getElementById("vaultStateButton"),
  vaultOutput:          document.getElementById("vaultOutput"),
  lpSummary:            document.getElementById("lpSummary"),
  lpYieldChart:         document.getElementById("lpYieldChart"),
  logOutput:            document.getElementById("logOutput")
};

// ── Helpers ────────────────────────────────────────────────
function log(message) {
  el.logOutput.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n${el.logOutput.textContent}`;
}

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

function showFeedback(kind, title, detail, txHash = "") {
  const icons = { success: "✅", error: "❌", info: "ℹ️", warning: "⚠️" };
  const icon = icons[kind] || "ℹ️";
  const explorer =
    txHash && state.network?.explorerBaseUrl
      ? `<a href="${state.network.explorerBaseUrl}${txHash}" target="_blank" rel="noreferrer">View tx ↗</a>`
      : txHash ? `<span>${txHash}</span>` : "";

  el.txFeedback.innerHTML = `
    <div class="feedback feedback-${kind}">
      <span class="feedback-icon">${icon}</span>
      <div class="feedback-body">
        <strong>${title}</strong>
        <span>${detail}</span>
        ${explorer}
      </div>
    </div>`;
}

function requireWallet() {
  if (!state.signer) throw new Error("Connect a wallet first.");
}

function requireContracts() {
  if (!state.contracts.policyFactory || !state.contracts.vault || !state.contracts.oracle)
    throw new Error("Load contract addresses first (click 'Load Contracts').");
}

function toSymbolBytes32(symbol) {
  return ethers.encodeBytes32String(symbol.trim().toUpperCase());
}

function parseTokenInput(value) {
  return ethers.parseUnits(String(value || "0"), state.tokenDecimals);
}

function parseDurationHours(value) {
  return BigInt(Math.floor(Number(value)) * 3600);
}

function formatToken(value) {
  return `${ethers.formatUnits(value, state.tokenDecimals)} ${state.tokenSymbol}`;
}

function formatUsd18(value) {
  return `${Number(ethers.formatUnits(value, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

function estimateFallbackQuote(input, symbolKey) {
  const market = MARKET_CONFIGS[symbolKey];
  const scenario = MARKET_SCENARIOS[symbolKey] || [];
  const latestSpot = scenario.length > 0 ? scenario[scenario.length - 1].price : Number(ethers.formatUnits(input.notional, state.tokenDecimals)) || 100;
  const notional = Number(ethers.formatUnits(input.notional, state.tokenDecimals));
  const strike = input.isDownsideProtection
    ? latestSpot * (1 - input.triggerBps / 10000)
    : latestSpot * (1 + input.triggerBps / 10000);
  const annualVolBps = market?.annualVolBps ?? 2600;
  const baseRateBps =
    (market?.basePremiumBps ?? 140) +
    (input.isDownsideProtection ? (market?.downsideSkewBps ?? 110) : (market?.upsideSkewBps ?? 90)) +
    Math.floor(annualVolBps / 25) +
    Math.floor(input.triggerBps / 18);
  const premium = Math.max(1, Math.floor((notional * baseRateBps) / 10000));
  const nowSec = Math.floor(Date.now() / 1000);

  return {
    premium: ethers.parseUnits(String(premium), state.tokenDecimals),
    spotPrice: ethers.parseUnits(latestSpot.toFixed(4), 18),
    strikePrice: ethers.parseUnits(strike.toFixed(4), 18),
    annualVolBps,
    estimatedProbabilityBps: Math.max(500, Math.min(8000, Math.floor((annualVolBps + input.triggerBps * 2) / 3))),
    oracleUpdatedAt: nowSec,
    effectiveSettlementTime: nowSec + Number(input.duration),
    oracleUsedFallback: true,
    settlesAtNextOpen: false,
    oracleSourceTag: ethers.encodeBytes32String("UI_FALLBACK"),
    directionalRiskBps: input.isDownsideProtection ? (market?.downsideSkewBps ?? 110) : (market?.upsideSkewBps ?? 90),
    inventoryPressureBps: input.isDownsideProtection ? (market?.downsideInventoryPressureBps ?? 70) : (market?.upsideInventoryPressureBps ?? 50),
    stressPremiumBps: market?.stressPremiumBps ?? 50,
    utilizationSurchargeBps: 180,
    overnightGapSurchargeBps: 80,
    isDownsideProtection: input.isDownsideProtection
  };
}

// ── Live chart ─────────────────────────────────────────────
async function refreshLiveChart() {
  const symbol = el.symbolInput.value;
  try {
    const candles = await fetchMarketCandles(symbol, state.deployment);
    drawCandlestickChart(el.livePriceChart, candles, `${symbol} — 1-week candles`);
    el.liveChartStatus.textContent = summarizeCandles(candles);
  } catch (error) {
    drawCandlestickChart(el.livePriceChart, [], `${symbol} — 1-week candles`);
    el.liveChartStatus.textContent = error.message;
  }
}

async function scheduleLiveChartRefresh() {
  if (state.liveChartTimer) clearInterval(state.liveChartTimer);
  await refreshLiveChart();
  const refreshIntervalMs = await getRefreshIntervalMs();
  state.liveChartTimer = setInterval(() => refreshLiveChart(), refreshIntervalMs);
}

async function syncLatestMarketPrice() {
  if (!state.deployment) {
    throw new Error("Load deployment metadata first by connecting wallet and loading contracts.");
  }

  const symbol = el.symbolInput.value.trim().toUpperCase();
  if (symbol === "MOCK") {
    throw new Error("MOCK uses its own local scenario playback and does not sync from yfinance.");
  }

  const runtimeConfig = await loadRuntimeConfig();
  const proxyPath = runtimeConfig?.syncMarketPriceProxyPath || "/api/sync-market-price";
  const provider = (runtimeConfig?.marketDataProvider || "yfinance").toLowerCase();

  showFeedback("info", "Syncing market price", `Fetching latest ${provider} price for ${symbol} and writing it to the local feed...`);
  const response = await fetch(`${proxyPath}?symbol=${encodeURIComponent(symbol)}&provider=${encodeURIComponent(provider)}`);
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || `Sync failed with HTTP ${response.status}`);
  }

  showFeedback("success", "Market price synced", `${symbol} updated to ${Number(data.latestClose).toFixed(2)} via ${data.provider}.`, data.txHash || "");
  log(`Synced ${symbol} from ${data.provider}:${data.remoteSymbol} -> ${Number(data.latestClose).toFixed(2)} (${data.txHash || "no tx hash"})`);

  await refreshLiveChart();

  if (state.signer && state.contracts.policyFactory && state.contracts.oracle) {
    try {
      await getQuote();
    } catch (error) {
      log(`Quote refresh after sync skipped: ${error.message}`);
    }
  }
}

// ── Presets ────────────────────────────────────────────────
function applyPreset(type) {
  const presets = {
    us:   { symbol: "AAPL",  notional: "1000", durationHours: "24",  direction: "down", triggerBps: "1000", deductible: "0",  payoutCap: "500" },
    hk:   { symbol: "0700HK",notional: "1000", durationHours: "24",  direction: "down", triggerBps: "1000", deductible: "0",  payoutCap: "500" },
    mock: { symbol: "MOCK",  notional: "1500", durationHours: "720", direction: "down", triggerBps: "1500", deductible: "25", payoutCap: "800" }
  };
  const preset = presets[type];
  if (!preset) return;
  el.symbolInput.value    = preset.symbol;
  el.notionalInput.value  = preset.notional;
  el.durationInput.value  = preset.durationHours;
  el.directionInput.value = preset.direction;
  el.triggerInput.value   = preset.triggerBps;
  el.deductibleInput.value= preset.deductible;
  el.payoutCapInput.value = preset.payoutCap;
  log(`Applied ${type.toUpperCase()} preset.`);
  scheduleLiveChartRefresh();
}

// ── Pill rendering ─────────────────────────────────────────
function renderPills(container, items) {
  container.innerHTML = "";
  for (const item of items) {
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = item;
    container.appendChild(span);
  }
}

// ── Bar chart (canvas) ─────────────────────────────────────
const CHART_PALETTE = ["#0052ff", "#26d1c8", "#f7a825", "#00c48c", "#f74b67", "#9b59b6"];

function drawBarChart(canvas, items, legendContainer) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const filtered = items.filter(item => item.value > 0);
  if (filtered.length === 0) {
    ctx.fillStyle = "rgba(106,140,176,0.6)";
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText("No data yet — run a quote first.", 16, 32);
    return;
  }

  const maxValue = Math.max(...filtered.map(i => i.value));
  const rowH = Math.floor((height - 20) / filtered.length);
  const labelW = 130;

  filtered.forEach((item, index) => {
    const y = 10 + index * rowH;
    const barW = Math.max(((item.value / maxValue) * (width - labelW - 60)), 4);
    const color = item.color || CHART_PALETTE[index % CHART_PALETTE.length];

    // bar bg
    ctx.fillStyle = "rgba(55,130,255,0.06)";
    ctx.beginPath();
    ctx.roundRect(labelW, y + 4, width - labelW - 56, rowH - 10, 4);
    ctx.fill();

    // bar fill
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(labelW, y + 4, barW, rowH - 10, 4);
    ctx.fill();

    // label
    ctx.fillStyle = "#9bb4d8";
    ctx.font = "12px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(item.label, labelW - 8, y + rowH / 2 + 4);

    // value
    ctx.fillStyle = "#e8f2ff";
    ctx.textAlign = "left";
    ctx.fillText(item.display, labelW + barW + 8, y + rowH / 2 + 4);
    ctx.textAlign = "start";
  });

  // legend
  if (legendContainer) {
    legendContainer.innerHTML = filtered.map((item, i) => `
      <span class="legend-item">
        <span class="legend-dot" style="background:${item.color || CHART_PALETTE[i % CHART_PALETTE.length]}"></span>
        ${item.label}: ${item.display}
      </span>`).join("");
  }
}

// ── Price/risk chart (canvas) ──────────────────────────────
function drawPriceChart(canvas, quote) {
  if (!canvas || !quote) return;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const spot   = Number(ethers.formatUnits(quote.spotPrice, 18));
  const strike = Number(ethers.formatUnits(quote.strikePrice, 18));
  const low    = Math.min(spot, strike) * 0.88;
  const high   = Math.max(spot, strike) * 1.12;
  const scaleX = v => 40 + ((v - low) / (high - low || 1)) * (width - 80);

  const midY = height / 2;

  // axis line
  ctx.strokeStyle = "rgba(55,130,255,0.18)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(30, midY); ctx.lineTo(width - 30, midY);
  ctx.stroke();
  ctx.setLineDash([]);

  // zone fill
  const isDown = quote.isDownsideProtection;
  const leftX  = isDown ? scaleX(strike) : scaleX(spot);
  const rightX = isDown ? scaleX(spot)   : scaleX(strike);
  if (rightX > leftX) {
    const grad = ctx.createLinearGradient(leftX, 0, rightX, 0);
    grad.addColorStop(0, "rgba(0,196,140,0.14)");
    grad.addColorStop(1, "rgba(0,196,140,0.04)");
    ctx.fillStyle = grad;
    ctx.fillRect(leftX, midY - 22, rightX - leftX, 44);
  }

  // Strike line
  const strikeX = scaleX(strike);
  ctx.strokeStyle = "#00c48c";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(strikeX, midY - 26); ctx.lineTo(strikeX, midY + 26);
  ctx.stroke();
  ctx.fillStyle = "#00c48c";
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Strike`, strikeX, midY - 30);
  ctx.fillText(`$${strike.toFixed(2)}`, strikeX, midY + 40);

  // Spot dot
  const spotX = scaleX(spot);
  ctx.fillStyle = "#0052ff";
  ctx.beginPath();
  ctx.arc(spotX, midY, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(spotX, midY, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#e8f2ff";
  ctx.font = "11px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Spot", spotX, midY - 16);
  ctx.fillText(`$${spot.toFixed(2)}`, spotX, midY + 40);

  // Footer stats
  ctx.fillStyle = "rgba(106,140,176,0.8)";
  ctx.font = "11px JetBrains Mono, monospace";
  ctx.textAlign = "left";
  ctx.fillText(`Vol ${(Number(quote.annualVolBps) / 100).toFixed(1)}%`, 10, height - 8);
  ctx.textAlign = "right";
  ctx.fillText(`Prob ${(Number(quote.estimatedProbabilityBps) / 100).toFixed(1)}%`, width - 10, height - 8);
  ctx.textAlign = "start";
}

// ── Network status ─────────────────────────────────────────
function renderNetworkStatus() {
  if (!state.network) {
    el.networkBadge.textContent = "No network";
    el.deploymentStatus.textContent = "Connect a wallet to detect the current network.";
    return;
  }
  el.networkBadge.textContent = `${state.network.chainName} (${state.network.chainId})`;
  el.deploymentStatus.textContent = state.deploymentFile
    ? `Deployment: ${state.deploymentFile}`
    : "No deployment file found. You can paste addresses manually.";
}

// ── Connect wallet ─────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) throw new Error("MetaMask or a Web3 wallet is required.");

  state.provider = new ethers.BrowserProvider(window.ethereum);
  await state.provider.send("eth_requestAccounts", []);
  state.signer  = await state.provider.getSigner();
  state.account = await state.signer.getAddress();
  state.network = await detectNetwork(state.provider);
  el.walletStatus.textContent = `Connected: ${state.account.slice(0, 6)}…${state.account.slice(-4)}`;
  renderNetworkStatus();

  const res = await loadDeploymentByChain(state.network.chainId);
  if (res) {
    state.deployment    = res.deployment;
    state.deploymentFile= res.fileName;
    el.policyFactoryAddress.value = res.deployment.contracts.policyFactory;
    el.vaultAddress.value         = res.deployment.contracts.insuranceVault;
    el.oracleAddress.value        = res.deployment.contracts.pricingOracle;
    renderNetworkStatus();
    log(`Loaded deployment from ${res.fileName}.`);
  } else {
    state.deployment = null;
    state.deploymentFile = null;
    renderNetworkStatus();
  }

  log(`Wallet connected: ${state.account}`);
  await scheduleLiveChartRefresh();
}

// ── Load contracts ─────────────────────────────────────────
async function loadContracts() {
  requireWallet();

  state.contracts.policyFactory = new ethers.Contract(el.policyFactoryAddress.value.trim(), policyFactoryAbi, state.signer);
  state.contracts.vault         = new ethers.Contract(el.vaultAddress.value.trim(), vaultAbi, state.signer);
  state.contracts.oracle        = new ethers.Contract(el.oracleAddress.value.trim(), oracleAbi, state.signer);

  const assetAddress = await state.contracts.vault.settlementAsset();
  state.contracts.token  = new ethers.Contract(assetAddress, erc20Abi, state.signer);
  state.tokenDecimals    = Number(await state.contracts.token.decimals());
  state.tokenSymbol      = await state.contracts.token.symbol();

  if (el.contractStatus) el.contractStatus.textContent = `✓ ${state.tokenSymbol}`;
  renderNetworkStatus();
  showFeedback("success", "Contracts loaded", `Settlement asset: ${state.tokenSymbol} at ${assetAddress}`);
  log(`Contracts loaded. Settlement asset: ${state.tokenSymbol} (${assetAddress})`);
  await scheduleLiveChartRefresh();
}

// ── ERC20 allowance ────────────────────────────────────────
async function ensureAllowance(spender, requiredAmount) {
  const allowance = await state.contracts.token.allowance(state.account, spender);
  if (allowance >= requiredAmount) return;

  const tx = await state.contracts.token.approve(spender, ethers.MaxUint256);
  showFeedback("info", "Approval submitted", "Waiting for allowance confirmation.", tx.hash);
  log(`Approval submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Allowance ready", "Approval confirmed.", tx.hash);
  log("Allowance approved.");
}

// ── Quote input builder ────────────────────────────────────
function currentQuoteInput() {
  return {
    symbol:              toSymbolBytes32(el.symbolInput.value),
    notional:            parseTokenInput(el.notionalInput.value),
    duration:            parseDurationHours(el.durationInput.value),
    triggerBps:          Number(el.triggerInput.value),
    deductible:          parseTokenInput(el.deductibleInput.value),
    payoutCap:           parseTokenInput(el.payoutCapInput.value),
    isDownsideProtection: el.directionInput.value === "down"
  };
}

// ── Render quote ───────────────────────────────────────────
function renderQuote(quote, marketOpen) {
  state.lastQuote = quote;

  el.quoteOutput.textContent =
    `premium:               ${formatToken(quote.premium)}\n` +
    `spotPrice:             ${formatUsd18(quote.spotPrice)}\n` +
    `strikePrice:           ${formatUsd18(quote.strikePrice)}\n` +
    `probability:           ${(Number(quote.estimatedProbabilityBps) / 100).toFixed(1)}%\n` +
    `impliedVol:            ${(Number(quote.annualVolBps) / 100).toFixed(1)}%\n` +
    `oracleUpdatedAt:       ${new Date(Number(quote.oracleUpdatedAt) * 1000).toLocaleString()}\n` +
    `effectiveSettlement:   ${new Date(Number(quote.effectiveSettlementTime) * 1000).toLocaleString()}\n` +
    `oracleFallback:        ${quote.oracleUsedFallback ? "YES ⚠️" : "No"}\n` +
    `settlesAtNextOpen:     ${quote.settlesAtNextOpen ? "YES" : "No"}\n` +
    `market:                ${marketOpen ? "🟢 Open" : "🔴 Closed"}`;

  renderPills(el.quoteKpis, [
    `💰 Premium ${formatToken(quote.premium)}`,
    `📍 Spot $${Number(ethers.formatUnits(quote.spotPrice, 18)).toFixed(2)}`,
    `🎯 Strike $${Number(ethers.formatUnits(quote.strikePrice, 18)).toFixed(2)}`,
    `📈 Vol ${(Number(quote.annualVolBps) / 100).toFixed(1)}%`,
    `🎲 Prob ${(Number(quote.estimatedProbabilityBps) / 100).toFixed(1)}%`,
    `🏛️ Market ${marketOpen ? "Open" : "Closed"}`,
    `🔭 Source ${decodeBytes32(quote.oracleSourceTag)}`
  ]);

  drawBarChart(el.quoteBreakdownChart, [
    { label: "Directional Risk", value: Number(quote.directionalRiskBps),      color: "#0052ff", display: `${quote.directionalRiskBps} bps` },
    { label: "Inventory",        value: Number(quote.inventoryPressureBps),     color: "#26d1c8", display: `${quote.inventoryPressureBps} bps` },
    { label: "Stress Premium",   value: Number(quote.stressPremiumBps),         color: "#f7a825", display: `${quote.stressPremiumBps} bps` },
    { label: "Utilization",      value: Number(quote.utilizationSurchargeBps),  color: "#00c48c", display: `${quote.utilizationSurchargeBps} bps` },
    { label: "Overnight Gap",    value: Number(quote.overnightGapSurchargeBps), color: "#f74b67", display: `${quote.overnightGapSurchargeBps} bps` }
  ], el.quoteBreakdownLegend);

  drawPriceChart(el.priceRiskChart, quote);
}

// ── Get quote ──────────────────────────────────────────────
async function getQuote() {
  requireWallet();
  requireContracts();

  const input = currentQuoteInput();
  const symbolKey = el.symbolInput.value.trim().toUpperCase();
  try {
    const [quote, marketOpen] = await Promise.all([
      state.contracts.policyFactory.previewPolicy(
        input.symbol, input.isDownsideProtection, input.notional,
        input.duration, input.triggerBps, input.deductible, input.payoutCap
      ),
      state.contracts.oracle.isMarketOpen(input.symbol)
    ]);

    state.lastQuoteMode = "onchain";
    renderQuote(quote, marketOpen);
    showFeedback("success", "Quote refreshed",
      `Premium ${formatToken(quote.premium)} | Market ${marketOpen ? "open 🟢" : "closed 🔴"}`);
    log("Quote refreshed (on-chain).");
    return quote;
  } catch (error) {
    const reason = decodeError(error, [policyFactoryInterface, oracleInterface, vaultInterface, erc20Interface]);
    const fallbackQuote = estimateFallbackQuote(input, symbolKey);
    state.lastQuoteMode = "fallback";
    renderQuote(fallbackQuote, false);
    showFeedback("warning", "On-chain quote unavailable",
      `${reason}. 已切换为前端演示报价（可视化可用，购买请切到 MOCK 或重部署 local）。`);
    log(`Quote fallback used: ${reason}`);
    return fallbackQuote;
  }
}

// ── Buy policy ─────────────────────────────────────────────
async function buyPolicy() {
  requireWallet();
  requireContracts();

  const quote = await getQuote();
  if (state.lastQuoteMode !== "onchain") {
    throw new Error("当前是前端演示报价，无法直接上链购买。请切换到 MOCK，或按新配置重新 deploy:local。");
  }
  const input = currentQuoteInput();

  await ensureAllowance(await state.contracts.vault.getAddress(), quote.premium);
  const tx = await state.contracts.policyFactory.purchasePolicy(
    input.symbol, input.isDownsideProtection, input.notional,
    input.duration, input.triggerBps, input.deductible, input.payoutCap
  );

  showFeedback("info", "Purchase submitted", "Waiting for on-chain confirmation…", tx.hash);
  log(`Purchase submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Policy purchased! 🎉",
    `${el.symbolInput.value} coverage activated. Check your policies below.`, tx.hash);
  log("Policy purchased.");
  await Promise.all([loadPolicies(), refreshVaultState()]);
}

// ── Settle policy ──────────────────────────────────────────
async function settlePolicy() {
  requireWallet();
  requireContracts();

  const policyId = BigInt(el.settlePolicyIdInput.value);
  const tx = await state.contracts.policyFactory.settlePolicy(policyId);
  showFeedback("info", "Settlement submitted", `Settling policy #${policyId}…`, tx.hash);
  log(`Settlement submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Policy settled", `Policy #${policyId} settled.`, tx.hash);
  log(`Policy ${policyId} settled.`);
  await Promise.all([loadPolicies(), refreshVaultState()]);
}

// ── Cancel policy ──────────────────────────────────────────
async function cancelPolicy() {
  requireWallet();
  requireContracts();

  const policyId = BigInt(el.cancelPolicyIdInput.value);
  const tx = await state.contracts.policyFactory.cancelPolicy(policyId);
  showFeedback("info", "Cancellation submitted", `Cancelling policy #${policyId}…`, tx.hash);
  log(`Cancellation submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Policy cancelled", `Policy #${policyId} cancelled.`, tx.hash);
  log(`Policy ${policyId} cancelled.`);
  await Promise.all([loadPolicies(), refreshVaultState()]);
}

// ── Render policy table ────────────────────────────────────
function renderPolicyTable(rows) {
  el.policiesTableBody.innerHTML = "";
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" class="table-empty">No policies found for this wallet.</td>`;
    el.policiesTableBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    const statusColor = STATUS_COLORS[row.statusLabel] || "#6a8cb0";
    const triggerColor =
      row.triggerResult === "Triggered" ? "var(--danger)"
        : row.triggerResult === "Not Triggered" ? "var(--success)"
          : "var(--muted)";
    tr.innerHTML = `
      <td><strong>#${row.id}</strong></td>
      <td><code style="color:#26d1c8">${row.symbol}</code></td>
      <td>${row.side === "Downside" ? "⬇️ Downside" : "⬆️ Upside"}</td>
      <td><span class="status-dot" style="background:${statusColor}"></span>${row.statusLabel}</td>
      <td style="color:${triggerColor};font-weight:600">${row.triggerResult}</td>
      <td style="white-space:nowrap;font-size:12px">${row.expiryLabel}</td>
      <td style="font-family:'JetBrains Mono',monospace">${row.notionalLabel}</td>
      <td style="font-family:'JetBrains Mono',monospace">${row.premiumLabel}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:${row.payoutLabel !== "0.0" ? "var(--success)" : "var(--muted)"}">${row.payoutLabel}</td>
    `;
    el.policiesTableBody.appendChild(tr);
  }
}

// ── Load policies ──────────────────────────────────────────
async function loadPolicies() {
  requireWallet();
  requireContracts();

  const [policyIds, latestBlock] = await Promise.all([
    state.contracts.policyFactory.getPoliciesByHolder(state.account),
    state.provider.getBlock("latest")
  ]);
  const nowTimestamp = latestBlock.timestamp;

  if (policyIds.length === 0) {
    el.policiesStatusOutput.textContent = "No policies found for the connected wallet.";
    el.policiesOutput.textContent = "[]";
    renderPills(el.policySummary, ["Active 0", "Expired 0", "Settled 0", "Cancelled 0"]);
    renderPolicyTable([]);
    state.lastPolicies = [];
    log("No policies found for current wallet.");
    return;
  }

  const rows = [];
  const counters = { Active: 0, Expired: 0, Settled: 0, Cancelled: 0 };

  for (const id of policyIds) {
    const policy = await state.contracts.policyFactory.getPolicy(id);
    const statusLabel = policyStatusLabel(policy, nowTimestamp);
    const triggerResult =
      statusLabel === "Settled"
        ? (policy.payoutAmount > 0n ? "Triggered" : "Not Triggered")
        : statusLabel === "Expired"
          ? "Awaiting Settlement"
          : statusLabel === "Cancelled"
            ? "Cancelled"
            : "Pending";
    counters[statusLabel] = (counters[statusLabel] || 0) + 1;
    rows.push({
      id:           policy.id.toString(),
      symbol:       decodeBytes32(policy.symbol),
      side:         policy.isDownsideProtection ? "Downside" : "Upside",
      statusLabel,
      triggerResult,
      expiryLabel:  new Date(Number(policy.expiry) * 1000).toLocaleString(),
      notionalLabel: ethers.formatUnits(policy.notional, state.tokenDecimals),
      premiumLabel:  ethers.formatUnits(policy.premiumPaid, state.tokenDecimals),
      payoutLabel:   ethers.formatUnits(policy.payoutAmount, state.tokenDecimals),
      raw: policy
    });
  }

  state.lastPolicies = rows;
  renderPills(el.policySummary, [
    `🟢 Active ${counters.Active}`,
    `🟡 Expired ${counters.Expired}`,
    `🔵 Settled ${counters.Settled}`,
    `⚫ Cancelled ${counters.Cancelled}`
  ]);
  renderPolicyTable(rows);

  el.policiesStatusOutput.textContent = `Found ${rows.length} polic${rows.length === 1 ? "y" : "ies"}.`;
  el.policiesOutput.textContent = JSON.stringify(
    rows.map(r => ({ id: r.id, symbol: r.symbol, side: r.side, status: r.statusLabel, triggerResult: r.triggerResult,
      expiry: r.expiryLabel, notional: r.notionalLabel, premium: r.premiumLabel, payout: r.payoutLabel })),
    null, 2
  );
  log(`Loaded ${rows.length} policies.`);
}

// ── Deposit liquidity ──────────────────────────────────────
async function depositLiquidity() {
  requireWallet();
  requireContracts();

  const amount = parseTokenInput(el.depositInput.value);
  await ensureAllowance(await state.contracts.vault.getAddress(), amount);
  const tx = await state.contracts.vault.deposit(amount);
  showFeedback("info", "Deposit submitted", `Depositing ${formatToken(amount)}…`, tx.hash);
  log(`Deposit submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Liquidity deposited", `${formatToken(amount)} added to vault.`, tx.hash);
  log("Liquidity deposited.");
  await refreshVaultState();
}

// ── Withdraw liquidity ─────────────────────────────────────
async function withdrawLiquidity() {
  requireWallet();
  requireContracts();

  const shareAmount = parseTokenInput(el.withdrawInput.value);
  const tx = await state.contracts.vault.withdraw(shareAmount);
  showFeedback("info", "Withdraw submitted", `Redeeming ${ethers.formatUnits(shareAmount, state.tokenDecimals)} shares.`, tx.hash);
  log(`Withdraw submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Liquidity withdrawn", "Withdrawal confirmed.", tx.hash);
  log("Liquidity withdrawn.");
  await refreshVaultState();
}

// ── Refresh vault state ────────────────────────────────────
async function refreshVaultState() {
  requireWallet();
  requireContracts();

  const [
    totalAssets, totalReserved, utilizationBps, availableLiquidity,
    totalShares, userShares, realizedPremiums, totalClaimsPaid,
    sharePrice, netUnderwritingResult, tokenBalance
  ] = await Promise.all([
    state.contracts.vault.totalAssets(),
    state.contracts.vault.totalReserved(),
    state.contracts.vault.utilizationBps(),
    state.contracts.vault.availableLiquidity(),
    state.contracts.vault.totalShares(),
    state.contracts.vault.shareBalance(state.account),
    state.contracts.vault.realizedPremiums(),
    state.contracts.vault.totalClaimsPaid(),
    state.contracts.vault.sharePrice(),
    state.contracts.vault.netUnderwritingResult(),
    state.contracts.token.balanceOf(state.account)
  ]);

  const withdrawableAssets = totalShares === 0n ? 0n : (userShares * totalAssets) / totalShares;
  const utilPct = Number(utilizationBps) / 100;

  // Utilization bar
  if (el.vaultUtilSection) {
    el.vaultUtilSection.style.display = "block";
    el.utilPct.textContent = `${utilPct.toFixed(1)}%`;
    const fill = el.utilBar;
    fill.style.width = `${Math.min(utilPct, 100)}%`;
    fill.className = `util-bar-fill${utilPct > 85 ? " danger" : utilPct > 70 ? " warn" : ""}`;
  }

  el.vaultOutput.textContent =
    `walletBalance:       ${formatToken(tokenBalance)}\n` +
    `totalAssets:         ${formatToken(totalAssets)}\n` +
    `totalReserved:       ${formatToken(totalReserved)}\n` +
    `availableLiquidity:  ${formatToken(availableLiquidity)}\n` +
    `utilizationBps:      ${utilizationBps} (${utilPct.toFixed(1)}%)\n` +
    `totalShares:         ${ethers.formatUnits(totalShares, state.tokenDecimals)}\n` +
    `myShares:            ${ethers.formatUnits(userShares, state.tokenDecimals)}\n` +
    `withdrawableAssets:  ${formatToken(withdrawableAssets)}\n` +
    `realizedPremiums:    ${formatToken(realizedPremiums)}\n` +
    `totalClaimsPaid:     ${formatToken(totalClaimsPaid)}\n` +
    `sharePrice:          ${ethers.formatUnits(sharePrice, 18)}\n` +
    `netP&L:              ${netUnderwritingResult >= 0n ? "+" : ""}${formatToken(netUnderwritingResult)}`;

  renderPills(el.lpSummary, [
    `💼 TVL ${formatToken(totalAssets)}`,
    `📊 Util ${utilPct.toFixed(1)}%`,
    `🔒 Reserved ${formatToken(totalReserved)}`,
    `💧 Available ${formatToken(availableLiquidity)}`,
    `🏷️ My Shares ${ethers.formatUnits(userShares, state.tokenDecimals)}`,
    `💸 Withdrawable ${formatToken(withdrawableAssets)}`
  ]);

  // LP yield chart
  drawBarChart(el.lpYieldChart, [
    { label: "Premiums Earned", value: Number(realizedPremiums),  color: "#00c48c", display: formatToken(realizedPremiums) },
    { label: "Claims Paid",     value: Number(totalClaimsPaid),   color: "#f74b67", display: formatToken(totalClaimsPaid) },
    { label: "Reserved",        value: Number(totalReserved),     color: "#0052ff", display: formatToken(totalReserved) }
  ], null);

  log("Vault state refreshed.");
}

// ── Error handler ──────────────────────────────────────────
async function run(action) {
  try {
    await action();
  } catch (error) {
    const reason = decodeError(error, [policyFactoryInterface, oracleInterface, vaultInterface, erc20Interface]);
    showFeedback("error", "Action failed", reason);
    log(`Error: ${reason}`);
  }
}

// ── Event listeners ────────────────────────────────────────
el.connectButton.addEventListener("click",       () => run(connectWallet));
el.presetUsButton.addEventListener("click",      () => applyPreset("us"));
el.presetHkButton.addEventListener("click",      () => applyPreset("hk"));
el.presetMockButton.addEventListener("click",    () => applyPreset("mock"));
el.saveAddressesButton.addEventListener("click", () => run(loadContracts));
el.quoteButton.addEventListener("click",         () => run(getQuote));
el.syncMarketPriceButton.addEventListener("click", () => run(syncLatestMarketPrice));
el.buyButton.addEventListener("click",           () => run(buyPolicy));
el.settleButton.addEventListener("click",        () => run(settlePolicy));
el.cancelButton.addEventListener("click",        () => run(cancelPolicy));
el.loadPoliciesButton.addEventListener("click",  () => run(loadPolicies));
el.depositButton.addEventListener("click",       () => run(depositLiquidity));
el.withdrawButton.addEventListener("click",      () => run(withdrawLiquidity));
el.vaultStateButton.addEventListener("click",    () => run(refreshVaultState));
el.symbolInput.addEventListener("change",        () => run(scheduleLiveChartRefresh));

// ── Init ───────────────────────────────────────────────────
run(async () => {
  if (!window.location.protocol.startsWith("http")) return;
  el.deploymentStatus.textContent = "Connect a wallet to auto-load network-specific addresses.";
  await scheduleLiveChartRefresh();
});
