import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";
import {
  policyFactoryAbi,
  vaultAbi,
  oracleAbi,
  erc20Abi,
  mockPriceFeedAbi,
  decodeBytes32,
  policyFactoryInterface,
  vaultInterface,
  oracleInterface,
  erc20Interface,
  detectNetwork,
  loadDeploymentByChain,
  decodeError,
  policyStatusLabel,
  liveTriggerPreview
} from "./shared.js";
import { MARKET_SCENARIOS } from "./scenarios.js";
import { drawCandlestickChart, fetchMarketCandles, summarizeCandles, getRefreshIntervalMs } from "./live-market.js";

const state = {
  provider: null,
  signer: null,
  account: null,
  tokenDecimals: 6,
  tokenSymbol: "USDC",
  deployment: null,
  network: null,
  contracts: {},
  mockScenarioIndex: 0,
  mockScenarioAnchorTimestamp: 0,
  mockAutoplayHandle: null,
  liveChartTimer: null
};

const MOCK_STEP_SECONDS = 24 * 60 * 60;
let runtimeConfigPromise = null;

const el = {
  connectButton: document.getElementById("connectButton"),
  walletStatus: document.getElementById("walletStatus"),
  roleHints: document.getElementById("roleHints"),
  policyFactoryAddress: document.getElementById("policyFactoryAddress"),
  vaultAddress: document.getElementById("vaultAddress"),
  oracleAddress: document.getElementById("oracleAddress"),
  loadContractsButton: document.getElementById("loadContractsButton"),
  monitorSymbol: document.getElementById("monitorSymbol"),
  refreshDashboardButton: document.getElementById("refreshDashboardButton"),
  dashboardOutput: document.getElementById("dashboardOutput"),
  monitorHolderInput: document.getElementById("monitorHolderInput"),
  refreshPoliciesButton: document.getElementById("refreshPoliciesButton"),
  monitoredPoliciesOutput: document.getElementById("monitoredPoliciesOutput"),
  liveAdminChartStatus: document.getElementById("liveAdminChartStatus"),
  adminLivePriceChart: document.getElementById("adminLivePriceChart"),
  pauseReasonInput: document.getElementById("pauseReasonInput"),
  closureDateInput: document.getElementById("closureDateInput"),
  calendarTypeInput: document.getElementById("calendarTypeInput"),
  closureStateInput: document.getElementById("closureStateInput"),
  pauseUnderwritingButton: document.getElementById("pauseUnderwritingButton"),
  unpauseUnderwritingButton: document.getElementById("unpauseUnderwritingButton"),
  pauseQuotingButton: document.getElementById("pauseQuotingButton"),
  unpauseQuotingButton: document.getElementById("unpauseQuotingButton"),
  setCalendarClosureButton: document.getElementById("setCalendarClosureButton"),
  maxUtilizationInput: document.getElementById("maxUtilizationInput"),
  emergencyUtilizationInput: document.getElementById("emergencyUtilizationInput"),
  minBufferInput: document.getElementById("minBufferInput"),
  maxDownsideInput: document.getElementById("maxDownsideInput"),
  maxUpsideInput: document.getElementById("maxUpsideInput"),
  maxShortInput: document.getElementById("maxShortInput"),
  maxMediumInput: document.getElementById("maxMediumInput"),
  maxLongInput: document.getElementById("maxLongInput"),
  configureRiskButton: document.getElementById("configureRiskButton"),
  limitSymbolInput: document.getElementById("limitSymbolInput"),
  symbolLimitInput: document.getElementById("symbolLimitInput"),
  setSymbolLimitButton: document.getElementById("setSymbolLimitButton"),
  marketSymbolInput: document.getElementById("marketSymbolInput"),
  basePremiumInput: document.getElementById("basePremiumInput"),
  maxNotionalInput: document.getElementById("maxNotionalInput"),
  minTriggerInput: document.getElementById("minTriggerInput"),
  maxTriggerInput: document.getElementById("maxTriggerInput"),
  openMinutesInput: document.getElementById("openMinutesInput"),
  closeMinutesInput: document.getElementById("closeMinutesInput"),
  closeBufferInput: document.getElementById("closeBufferInput"),
  overnightGapInput: document.getElementById("overnightGapInput"),
  marketCalendarInput: document.getElementById("marketCalendarInput"),
  settlementModeInput: document.getElementById("settlementModeInput"),
  enforceHoursInput: document.getElementById("enforceHoursInput"),
  allowFallbackInput: document.getElementById("allowFallbackInput"),
  marketActiveInput: document.getElementById("marketActiveInput"),
  configureMarketButton: document.getElementById("configureMarketButton"),
  riskProviderInput: document.getElementById("riskProviderInput"),
  oracleAdapterInput: document.getElementById("oracleAdapterInput"),
  setRiskProviderButton: document.getElementById("setRiskProviderButton"),
  setOracleAdapterButton: document.getElementById("setOracleAdapterButton"),
  mockPlaybackMsInput: document.getElementById("mockPlaybackMsInput"),
  loadMockScenarioButton: document.getElementById("loadMockScenarioButton"),
  prevMockCandleButton: document.getElementById("prevMockCandleButton"),
  nextMockCandleButton: document.getElementById("nextMockCandleButton"),
  autoplayMockButton: document.getElementById("autoplayMockButton"),
  mockScenarioOutput: document.getElementById("mockScenarioOutput"),
  mockPathChart: document.getElementById("mockPathChart"),
  logOutput: document.getElementById("logOutput")
};

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

function requireWallet() {
  if (!state.signer) {
    throw new Error("Connect an admin wallet first.");
  }
}

function requireContracts() {
  if (!state.contracts.policyFactory || !state.contracts.oracle || !state.contracts.vault) {
    throw new Error("Load contract addresses first.");
  }
}

function toSymbol(symbol) {
  return ethers.encodeBytes32String(symbol.trim().toUpperCase());
}

function parseToken(value) {
  return ethers.parseUnits(String(value || "0"), state.tokenDecimals);
}

function formatToken(value) {
  return `${ethers.formatUnits(value, state.tokenDecimals)} ${state.tokenSymbol}`;
}

function parseBool(value) {
  return value === "true";
}

async function refreshAdminLiveChart() {
  const symbol = el.monitorSymbol.value;

  try {
    const candles = await fetchMarketCandles(symbol, state.deployment);
    drawCandlestickChart(el.adminLivePriceChart, candles, `${symbol} 1-week candles`);
    el.liveAdminChartStatus.textContent = summarizeCandles(candles);
  } catch (error) {
    drawCandlestickChart(el.adminLivePriceChart, [], `${symbol} 1-week candles`);
    el.liveAdminChartStatus.textContent = error.message;
  }
}

async function scheduleAdminLiveChartRefresh() {
  if (state.liveChartTimer) {
    clearInterval(state.liveChartTimer);
  }

  await refreshAdminLiveChart();
  const refreshIntervalMs = await getRefreshIntervalMs();
  state.liveChartTimer = setInterval(() => {
    refreshAdminLiveChart();
  }, refreshIntervalMs);
}

function getMockScenario() {
  return MARKET_SCENARIOS.MOCK || [];
}

function drawMockScenarioChart() {
  const canvas = el.mockPathChart;
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const path = getMockScenario();
  if (!path.length) {
    ctx.fillStyle = "rgba(106,140,176,0.55)";
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText("MOCK path unavailable.", 16, 28);
    return;
  }

  const padL = 48;
  const padR = 18;
  const padT = 20;
  const padB = 24;
  const drawW = width - padL - padR;
  const drawH = height - padT - padB;
  const prices = path.map((point) => point.price);
  const minPrice = Math.min(...prices) * 0.96;
  const maxPrice = Math.max(...prices) * 1.04;
  const range = Math.max(maxPrice - minPrice, 0.0001);
  const toX = (index) => padL + (index / Math.max(path.length - 1, 1)) * drawW;
  const toY = (price) => padT + ((maxPrice - price) / range) * drawH;

  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padT + (i / 4) * drawH;
    const price = maxPrice - (i / 4) * (maxPrice - minPrice);
    ctx.strokeStyle = "rgba(55,130,255,0.10)";
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(width - padR, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(106,140,176,0.7)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`$${price.toFixed(0)}`, padL - 4, y + 3);
  }
  ctx.setLineDash([]);
  ctx.textAlign = "start";

  const gradient = ctx.createLinearGradient(0, padT, 0, height - padB);
  gradient.addColorStop(0, "rgba(38,209,200,0.20)");
  gradient.addColorStop(1, "rgba(38,209,200,0.03)");
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(path[0].price));
  path.forEach((point, index) => ctx.lineTo(toX(index), toY(point.price)));
  ctx.lineTo(toX(path.length - 1), height - padB);
  ctx.lineTo(toX(0), height - padB);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.strokeStyle = "#26d1c8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(path[0].price));
  path.forEach((point, index) => ctx.lineTo(toX(index), toY(point.price)));
  ctx.stroke();

  const currentIndex = Math.max(0, Math.min(state.mockScenarioIndex, path.length - 1));
  const current = path[currentIndex];
  const markerX = toX(currentIndex);
  const markerY = toY(current.price);

  ctx.strokeStyle = "rgba(247,168,37,0.85)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(markerX, padT);
  ctx.lineTo(markerX, height - padB);
  ctx.stroke();

  ctx.fillStyle = "#f7a825";
  ctx.beginPath();
  ctx.arc(markerX, markerY, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(184,212,242,0.85)";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText("MOCK month price path", padL, 14);
  ctx.textAlign = "right";
  ctx.fillStyle = "#f7a825";
  ctx.fillText(`Step ${currentIndex + 1}/${path.length}  $${current.price.toFixed(2)}`, width - padR, 14);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(106,140,176,0.72)";
  ctx.font = "10px Inter, sans-serif";
  [0, Math.floor(path.length / 2), path.length - 1].forEach((index) => {
    const point = path[index];
    if (point) ctx.fillText(point.date, toX(index), height - 8);
  });
  ctx.textAlign = "start";
}

function renderMockScenarioStatus(extra = "") {
  const path = getMockScenario();
  const current = path[state.mockScenarioIndex];
  const feedAddress = state.deployment?.markets?.MOCK?.spotFeed || "not deployed";
  const demoTimestamp =
    state.mockScenarioAnchorTimestamp > 0
      ? state.mockScenarioAnchorTimestamp + state.mockScenarioIndex * MOCK_STEP_SECONDS
      : 0;

  if (!current) {
    el.mockScenarioOutput.textContent = "MOCK scenario unavailable.";
    return;
  }

  el.mockScenarioOutput.textContent =
    `feedAddress: ${feedAddress}\n` +
    `step: ${state.mockScenarioIndex + 1} / ${path.length}\n` +
    `scenarioDateLabel: ${current.date}\n` +
    (demoTimestamp > 0 ? `demoBlockTime: ${new Date(demoTimestamp * 1000).toLocaleString()}\n` : "") +
    `price: ${current.price}\n` +
    `features: month-long path with range, rally, selloff, rebound\n` +
    (extra ? `note: ${extra}\n` : "");
  drawMockScenarioChart();
}

async function safeGetSpotPrice(symbol) {
  try {
    return await state.contracts.oracle.getSpotPrice(ethers.encodeBytes32String(symbol));
  } catch {
    return 0n;
  }
}

async function refreshMonitoredPolicies() {
  requireWallet();
  requireContracts();

  const holder = el.monitorHolderInput.value.trim();
  if (!holder) {
    throw new Error("Enter a holder address to monitor.");
  }

  const [policyIds, latestBlock] = await Promise.all([
    state.contracts.policyFactory.getPoliciesByHolder(holder),
    state.provider.getBlock("latest")
  ]);

  const nowTimestamp = latestBlock.timestamp;
  if (!policyIds.length) {
    el.monitoredPoliciesOutput.textContent = `No policies found for ${holder}.`;
    return;
  }

  const policies = await Promise.all(
    policyIds.map((id) => state.contracts.policyFactory.getPolicy(id))
  );

  const monitorSymbol = el.monitorSymbol.value.trim().toUpperCase();
  const filteredPolicies = policies.filter((policy) => decodeBytes32(policy.symbol) === monitorSymbol);

  if (!filteredPolicies.length) {
    el.monitoredPoliciesOutput.textContent = `No ${monitorSymbol} policies found for ${holder}.`;
    return;
  }

  const symbols = [...new Set(filteredPolicies.map((policy) => decodeBytes32(policy.symbol)))];
  const spotEntries = await Promise.all(
    symbols.map(async (symbol) => {
      const spot = await safeGetSpotPrice(symbol);
      return [symbol, spot];
    })
  );
  const spotMap = new Map(spotEntries);

  const lines = filteredPolicies
    .map((policy) => {
      const symbol = decodeBytes32(policy.symbol);
      const spot = spotMap.get(symbol) || 0n;
      const statusLabel = policyStatusLabel(policy, nowTimestamp);
      const triggerPreview = liveTriggerPreview(policy, nowTimestamp, spot);
      return [
        `policyId: ${policy.id.toString()}`,
        `symbol: ${symbol}`,
        `status: ${statusLabel}`,
        `triggerPreview: ${triggerPreview}`,
        `entryPrice: ${ethers.formatUnits(policy.entryPrice, 18)}`,
        `strikePrice: ${ethers.formatUnits(policy.strikePrice, 18)}`,
        `currentSpot: ${ethers.formatUnits(spot, 18)}`,
        `expiry: ${new Date(Number(policy.expiry) * 1000).toLocaleString()}`,
        `payout: ${ethers.formatUnits(policy.payoutAmount, state.tokenDecimals)} ${state.tokenSymbol}`
      ].join(" | ");
    });

  el.monitoredPoliciesOutput.textContent = lines.length
    ? lines.join("\n")
    : `No ${monitorSymbol} policies found for ${holder}.`;
}

async function pushMockCandle(index, note = "") {
  requireWallet();
  requireContracts();

  const feedAddress = state.deployment?.markets?.MOCK?.spotFeed;
  if (!feedAddress) {
    throw new Error("MOCK feed not found in deployment metadata.");
  }

  const path = getMockScenario();
  const safeIndex = Math.max(0, Math.min(index, path.length - 1));
  const candle = path[safeIndex];
  const mockFeed = new ethers.Contract(feedAddress, mockPriceFeedAbi, state.signer);
  const scaledPrice = BigInt(Math.round(candle.price * 1e8));
  const latestBlock = await state.provider.getBlock("latest");
  const targetTimestamp = Math.max(
    Number(latestBlock.timestamp) + 1,
    (state.mockScenarioAnchorTimestamp || Number(latestBlock.timestamp)) + safeIndex * MOCK_STEP_SECONDS
  );

  if (state.network?.chainId === 31337) {
    const runtimeConfig = await loadRuntimeConfig();
    const advanceTimePath = runtimeConfig?.advanceTimeProxyPath || "/api/advance-time";
    const response = await fetch(`${advanceTimePath}?timestamp=${encodeURIComponent(targetTimestamp)}`);
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || `Failed to advance local chain time (HTTP ${response.status})`);
    }
  }

  const tx = await mockFeed.setAnswerWithTimestamp(scaledPrice, BigInt(targetTimestamp));
  log(`MOCK candle submitted: ${tx.hash}`);
  await tx.wait();
  state.mockScenarioIndex = safeIndex;
  renderMockScenarioStatus(note || "On-chain MOCK feed updated.");
  await refreshMonitoredPolicies();
  log(`MOCK moved to step ${safeIndex + 1} (${candle.date}, ${candle.price}) at ${new Date(targetTimestamp * 1000).toLocaleString()}.`);
}

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask or another injected wallet is required.");
  }

  state.provider = new ethers.BrowserProvider(window.ethereum);
  await state.provider.send("eth_requestAccounts", []);
  state.signer = await state.provider.getSigner();
  state.account = await state.signer.getAddress();
  state.network = await detectNetwork(state.provider);
  el.walletStatus.textContent = `Connected: ${state.account} on ${state.network.chainName}`;

  const deploymentResult = await loadDeploymentByChain(state.network.chainId);
  if (deploymentResult) {
    state.deployment = deploymentResult.deployment;
    el.policyFactoryAddress.value = deploymentResult.deployment.contracts.policyFactory;
    el.vaultAddress.value = deploymentResult.deployment.contracts.insuranceVault;
    el.oracleAddress.value = deploymentResult.deployment.contracts.pricingOracle;
    if (!el.monitorHolderInput.value && deploymentResult.deployment.accounts?.buyer) {
      el.monitorHolderInput.value = deploymentResult.deployment.accounts.buyer;
    }
    renderRoleHints();
    log(`Loaded deployment addresses from ${deploymentResult.fileName}.`);
  }

  log(`Wallet connected: ${state.account}`);
  drawMockScenarioChart();
  await scheduleAdminLiveChartRefresh();
}

function renderRoleHints() {
  el.roleHints.innerHTML = "";
  if (!state.deployment?.accounts) {
    return;
  }

  for (const [role, address] of Object.entries(state.deployment.accounts)) {
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = `${role}: ${address}`;
    el.roleHints.appendChild(span);
  }
}

async function loadContracts() {
  requireWallet();

  state.contracts.policyFactory = new ethers.Contract(el.policyFactoryAddress.value.trim(), policyFactoryAbi, state.signer);
  state.contracts.oracle = new ethers.Contract(el.oracleAddress.value.trim(), oracleAbi, state.signer);
  state.contracts.vault = new ethers.Contract(el.vaultAddress.value.trim(), vaultAbi, state.signer);

  const assetAddress = await state.contracts.vault.settlementAsset();
  state.contracts.token = new ethers.Contract(assetAddress, erc20Abi, state.signer);
  state.tokenDecimals = Number(await state.contracts.token.decimals());
  state.tokenSymbol = await state.contracts.token.symbol();

  el.riskProviderInput.value = await state.contracts.oracle.riskParameterProvider();
  el.oracleAdapterInput.value = await state.contracts.oracle.oracleAdapter();
  if (!el.monitorHolderInput.value && state.deployment?.accounts?.buyer) {
    el.monitorHolderInput.value = state.deployment.accounts.buyer;
  }
  log(`Contracts loaded. Settlement asset: ${state.tokenSymbol} (${assetAddress})`);
  drawMockScenarioChart();
  await scheduleAdminLiveChartRefresh();
  await refreshMonitoredPolicies();
}

async function refreshDashboard() {
  requireWallet();
  requireContracts();

  const symbol = toSymbol(el.monitorSymbol.value);
  const latestBlock = await state.provider.getBlock("latest");
  const now = BigInt(latestBlock.timestamp);
  const [
    totalAssets,
    totalReserved,
    utilizationBps,
    availableLiquidity,
    totalShares,
    realizedPremiums,
    totalClaimsPaid,
    sharePrice,
    netUnderwritingResult,
    activePolicies,
    underwritingPaused,
    quotingPaused,
    symbolExposure,
    symbolLimit,
    downsideExposure,
    upsideExposure,
    shortTermExposure,
    mediumTermExposure,
    longTermExposure,
    maxUtilizationBps,
    emergencyPauseUtilizationBps,
    minimumLiquidityBuffer,
    maxDownsideExposure,
    maxUpsideExposure,
    maxShortTermExposure,
    maxMediumTermExposure,
    maxLongTermExposure,
    isMarketOpen,
    spotPrice,
    sessionWindow,
    riskProvider,
    oracleAdapter
  ] = await Promise.all([
    state.contracts.vault.totalAssets(),
    state.contracts.vault.totalReserved(),
    state.contracts.vault.utilizationBps(),
    state.contracts.vault.availableLiquidity(),
    state.contracts.vault.totalShares(),
    state.contracts.vault.realizedPremiums(),
    state.contracts.vault.totalClaimsPaid(),
    state.contracts.vault.sharePrice(),
    state.contracts.vault.netUnderwritingResult(),
    state.contracts.policyFactory.getActivePoliciesCount(),
    state.contracts.policyFactory.underwritingPaused(),
    state.contracts.policyFactory.paused(),
    state.contracts.policyFactory.symbolExposure(symbol),
    state.contracts.policyFactory.symbolExposureLimit(symbol),
    state.contracts.policyFactory.downsideExposure(),
    state.contracts.policyFactory.upsideExposure(),
    state.contracts.policyFactory.shortTermExposure(),
    state.contracts.policyFactory.mediumTermExposure(),
    state.contracts.policyFactory.longTermExposure(),
    state.contracts.policyFactory.maxUtilizationBps(),
    state.contracts.policyFactory.emergencyPauseUtilizationBps(),
    state.contracts.policyFactory.minimumLiquidityBuffer(),
    state.contracts.policyFactory.maxDownsideExposure(),
    state.contracts.policyFactory.maxUpsideExposure(),
    state.contracts.policyFactory.maxShortTermExposure(),
    state.contracts.policyFactory.maxMediumTermExposure(),
    state.contracts.policyFactory.maxLongTermExposure(),
    state.contracts.oracle.isMarketOpen(symbol),
    state.contracts.oracle.getSpotPrice(symbol),
    state.contracts.oracle.getSessionWindow(symbol, now),
    state.contracts.oracle.riskParameterProvider(),
    state.contracts.oracle.oracleAdapter()
  ]);

  el.dashboardOutput.textContent =
    `symbol: ${el.monitorSymbol.value}\n` +
    `spotPrice: ${ethers.formatUnits(spotPrice, 18)} USD\n` +
    `marketOpen: ${isMarketOpen}\n` +
    `sessionLocalDateKey: ${sessionWindow[2]}\n` +
    `sessionMinutesLocal: ${sessionWindow[3]}\n` +
    `sessionOpenAt: ${new Date(Number(sessionWindow[4]) * 1000).toLocaleString()}\n` +
    `sessionCloseAt: ${new Date(Number(sessionWindow[5]) * 1000).toLocaleString()}\n` +
    `nextOpenAt: ${new Date(Number(sessionWindow[6]) * 1000).toLocaleString()}\n` +
    `underwritingPaused: ${underwritingPaused}\n` +
    `quotingPaused: ${quotingPaused}\n` +
    `activePolicies: ${activePolicies}\n` +
    `totalAssets: ${formatToken(totalAssets)}\n` +
    `totalReserved: ${formatToken(totalReserved)}\n` +
    `availableLiquidity: ${formatToken(availableLiquidity)}\n` +
    `utilizationBps: ${utilizationBps}\n` +
    `totalShares: ${ethers.formatUnits(totalShares, state.tokenDecimals)}\n` +
    `realizedPremiums: ${formatToken(realizedPremiums)}\n` +
    `totalClaimsPaid: ${formatToken(totalClaimsPaid)}\n` +
    `sharePrice: ${ethers.formatUnits(sharePrice, 18)}\n` +
    `netUnderwritingResult: ${netUnderwritingResult}\n` +
    `symbolExposure: ${formatToken(symbolExposure)}\n` +
    `symbolExposureLimit: ${formatToken(symbolLimit)}\n` +
    `downsideExposure: ${formatToken(downsideExposure)}\n` +
    `upsideExposure: ${formatToken(upsideExposure)}\n` +
    `shortTermExposure: ${formatToken(shortTermExposure)}\n` +
    `mediumTermExposure: ${formatToken(mediumTermExposure)}\n` +
    `longTermExposure: ${formatToken(longTermExposure)}\n` +
    `maxUtilizationBps: ${maxUtilizationBps}\n` +
    `emergencyPauseUtilizationBps: ${emergencyPauseUtilizationBps}\n` +
    `minimumLiquidityBuffer: ${formatToken(minimumLiquidityBuffer)}\n` +
    `maxDownsideExposure: ${formatToken(maxDownsideExposure)}\n` +
    `maxUpsideExposure: ${formatToken(maxUpsideExposure)}\n` +
    `maxShortTermExposure: ${formatToken(maxShortTermExposure)}\n` +
    `maxMediumTermExposure: ${formatToken(maxMediumTermExposure)}\n` +
    `maxLongTermExposure: ${formatToken(maxLongTermExposure)}\n` +
    `riskParameterProvider: ${riskProvider}\n` +
    `oracleAdapter: ${oracleAdapter}`;

  el.riskProviderInput.value = riskProvider;
  el.oracleAdapterInput.value = oracleAdapter;
  await refreshMonitoredPolicies();
  log("Dashboard refreshed.");
}

async function setUnderwritingPaused(paused) {
  requireWallet();
  requireContracts();

  const tx = await state.contracts.policyFactory.setUnderwritingPaused(
    paused,
    ethers.encodeBytes32String(el.pauseReasonInput.value || (paused ? "PAUSED" : "UNPAUSED"))
  );
  log(`Underwriting pause update submitted: ${tx.hash}`);
  await tx.wait();
  log(`Underwriting pause set to ${paused}.`);
}

async function unpauseUnderwriting() {
  requireWallet();
  requireContracts();

  const tx = await state.contracts.policyFactory.unpauseUnderwriting();
  log(`Underwriting unpause submitted: ${tx.hash}`);
  await tx.wait();
  log("Underwriting unpaused.");
}

async function pauseQuoting() {
  requireWallet();
  requireContracts();

  const tx = await state.contracts.oracle.pauseQuoting();
  log(`Quote pause submitted: ${tx.hash}`);
  await tx.wait();
  log("Quoting paused.");
}

async function unpauseQuoting() {
  requireWallet();
  requireContracts();

  const tx = await state.contracts.oracle.unpauseQuoting();
  log(`Quote unpause submitted: ${tx.hash}`);
  await tx.wait();
  log("Quoting unpaused.");
}

async function setCalendarClosure() {
  requireWallet();
  requireContracts();

  const tx = await state.contracts.oracle.setCalendarClosure(
    Number(el.calendarTypeInput.value),
    BigInt(el.closureDateInput.value),
    parseBool(el.closureStateInput.value)
  );
  log(`Calendar closure submitted: ${tx.hash}`);
  await tx.wait();
  log("Calendar closure updated.");
}

async function configureRiskLimits() {
  requireWallet();
  requireContracts();

  const tx = await state.contracts.policyFactory.configureRiskLimits(
    BigInt(el.maxUtilizationInput.value),
    BigInt(el.emergencyUtilizationInput.value),
    parseToken(el.minBufferInput.value),
    parseToken(el.maxDownsideInput.value),
    parseToken(el.maxUpsideInput.value),
    parseToken(el.maxShortInput.value),
    parseToken(el.maxMediumInput.value),
    parseToken(el.maxLongInput.value)
  );
  log(`Risk limit update submitted: ${tx.hash}`);
  await tx.wait();
  log("Risk limits updated.");
}

async function setSymbolLimit() {
  requireWallet();
  requireContracts();

  const tx = await state.contracts.policyFactory.setSymbolExposureLimit(
    toSymbol(el.limitSymbolInput.value),
    parseToken(el.symbolLimitInput.value)
  );
  log(`Symbol limit update submitted: ${tx.hash}`);
  await tx.wait();
  log("Symbol exposure limit updated.");
}

async function configureMarket() {
  requireWallet();
  requireContracts();

  const tx = await state.contracts.oracle.configureMarket(toSymbol(el.marketSymbolInput.value), {
    minDuration: 3600,
    maxDuration: 30 * 24 * 3600,
    basePremiumBps: BigInt(el.basePremiumInput.value),
    maxNotional: parseToken(el.maxNotionalInput.value),
    minTriggerBps: Number(el.minTriggerInput.value),
    maxTriggerBps: Number(el.maxTriggerInput.value),
    openMinutesLocal: Number(el.openMinutesInput.value),
    closeMinutesLocal: Number(el.closeMinutesInput.value),
    closeBufferMinutes: Number(el.closeBufferInput.value),
    overnightGapSurchargeBps: Number(el.overnightGapInput.value),
    enforceMarketHours: parseBool(el.enforceHoursInput.value),
    allowFallbackOracle: parseBool(el.allowFallbackInput.value),
    settlementMode: Number(el.settlementModeInput.value),
    calendarType: Number(el.marketCalendarInput.value),
    isActive: parseBool(el.marketActiveInput.value)
  });
  log(`Market config submitted: ${tx.hash}`);
  await tx.wait();
  log(`Market ${el.marketSymbolInput.value} configured.`);
}

async function setRiskProvider() {
  requireWallet();
  requireContracts();

  const tx = await state.contracts.oracle.setRiskParameterProvider(el.riskProviderInput.value.trim());
  log(`Risk provider update submitted: ${tx.hash}`);
  await tx.wait();
  log("Risk provider updated.");
}

async function setOracleAdapter() {
  requireWallet();
  requireContracts();

  const tx = await state.contracts.oracle.setOracleAdapter(el.oracleAdapterInput.value.trim());
  log(`Oracle adapter update submitted: ${tx.hash}`);
  await tx.wait();
  log("Oracle adapter updated.");
}

async function loadMockScenario() {
  const latestBlock = await state.provider.getBlock("latest");
  state.mockScenarioAnchorTimestamp = Number(latestBlock.timestamp);
  state.mockScenarioIndex = 0;
  renderMockScenarioStatus("Loaded local MOCK path.");
  if (state.deployment?.markets?.MOCK?.spotFeed) {
    await pushMockCandle(0, "Reset MOCK feed to the first candle.");
  }
}

async function shiftMockCandle(delta) {
  await pushMockCandle(state.mockScenarioIndex + delta);
}

async function autoplayMockScenario() {
  const path = getMockScenario();
  const delayMs = Math.max(50, Number(el.mockPlaybackMsInput.value || 300));

  if (state.mockAutoplayHandle) {
    clearTimeout(state.mockAutoplayHandle);
    state.mockAutoplayHandle = null;
    renderMockScenarioStatus("Autoplay stopped.");
    log("Stopped MOCK autoplay.");
    return;
  }

  const playStep = async () => {
    await pushMockCandle(state.mockScenarioIndex, "Autoplaying MOCK month.");
    if (state.mockScenarioIndex >= path.length - 1) {
      clearTimeout(state.mockAutoplayHandle);
      state.mockAutoplayHandle = null;
      renderMockScenarioStatus("Autoplay finished.");
      log("Completed MOCK autoplay.");
      return;
    }

    state.mockScenarioIndex += 1;
    state.mockAutoplayHandle = setTimeout(() => {
      run(playStep);
    }, delayMs);
  };

  log("Starting MOCK autoplay.");
  await playStep();
}

async function run(action) {
  try {
    await action();
  } catch (error) {
    const reason = decodeError(error, [policyFactoryInterface, oracleInterface, vaultInterface, erc20Interface]);
    log(`Error: ${reason}`);
  }
}

el.connectButton.addEventListener("click", () => run(connectWallet));
el.loadContractsButton.addEventListener("click", () => run(loadContracts));
el.refreshDashboardButton.addEventListener("click", () => run(refreshDashboard));
el.refreshPoliciesButton.addEventListener("click", () => run(refreshMonitoredPolicies));
el.monitorSymbol.addEventListener("change", () => run(async () => {
  await scheduleAdminLiveChartRefresh();
  await refreshMonitoredPolicies();
}));
el.pauseUnderwritingButton.addEventListener("click", () => run(() => setUnderwritingPaused(true)));
el.unpauseUnderwritingButton.addEventListener("click", () => run(unpauseUnderwriting));
el.pauseQuotingButton.addEventListener("click", () => run(pauseQuoting));
el.unpauseQuotingButton.addEventListener("click", () => run(unpauseQuoting));
el.setCalendarClosureButton.addEventListener("click", () => run(setCalendarClosure));
el.configureRiskButton.addEventListener("click", () => run(configureRiskLimits));
el.setSymbolLimitButton.addEventListener("click", () => run(setSymbolLimit));
el.configureMarketButton.addEventListener("click", () => run(configureMarket));
el.setRiskProviderButton.addEventListener("click", () => run(setRiskProvider));
el.setOracleAdapterButton.addEventListener("click", () => run(setOracleAdapter));
el.loadMockScenarioButton.addEventListener("click", () => run(loadMockScenario));
el.prevMockCandleButton.addEventListener("click", () => run(() => shiftMockCandle(-1)));
el.nextMockCandleButton.addEventListener("click", () => run(() => shiftMockCandle(1)));
el.autoplayMockButton.addEventListener("click", () => run(autoplayMockScenario));

run(async () => {
  if (!window.location.protocol.startsWith("http")) {
    return;
  }

  const response = await fetch("./deployments/localhost.json");
  if (response.ok) {
    state.deployment = await response.json();
    el.policyFactoryAddress.value = state.deployment.contracts.policyFactory;
    el.vaultAddress.value = state.deployment.contracts.insuranceVault;
    el.oracleAddress.value = state.deployment.contracts.pricingOracle;
    renderRoleHints();
    log("Loaded local deployment addresses and admin account hints.");
    renderMockScenarioStatus("Local MOCK presentation path ready.");
    drawCandlestickChart(el.adminLivePriceChart, [], "Intraday candles");
  }
});
