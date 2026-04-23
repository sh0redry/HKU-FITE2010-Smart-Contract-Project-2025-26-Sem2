import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";
import {
  policyFactoryAbi,
  vaultAbi,
  oracleAbi,
  erc20Abi,
  mockPriceFeedAbi,
  policyFactoryInterface,
  vaultInterface,
  oracleInterface,
  erc20Interface,
  detectNetwork,
  loadDeploymentByChain,
  decodeError
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
  mockAutoplayHandle: null,
  liveChartTimer: null
};

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
  logOutput: document.getElementById("logOutput")
};

function log(message) {
  el.logOutput.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n${el.logOutput.textContent}`;
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
    drawCandlestickChart(el.adminLivePriceChart, candles, `${symbol} intraday candles`);
    el.liveAdminChartStatus.textContent = summarizeCandles(candles);
  } catch (error) {
    drawCandlestickChart(el.adminLivePriceChart, [], `${symbol} intraday candles`);
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

function renderMockScenarioStatus(extra = "") {
  const path = getMockScenario();
  const current = path[state.mockScenarioIndex];
  const feedAddress = state.deployment?.markets?.MOCK?.spotFeed || "not deployed";

  if (!current) {
    el.mockScenarioOutput.textContent = "MOCK scenario unavailable.";
    return;
  }

  el.mockScenarioOutput.textContent =
    `feedAddress: ${feedAddress}\n` +
    `step: ${state.mockScenarioIndex + 1} / ${path.length}\n` +
    `date: ${current.date}\n` +
    `price: ${current.price}\n` +
    `features: month-long path with range, rally, selloff, rebound\n` +
    (extra ? `note: ${extra}\n` : "");
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
  const tx = await mockFeed.setAnswer(scaledPrice);
  log(`MOCK candle submitted: ${tx.hash}`);
  await tx.wait();
  state.mockScenarioIndex = safeIndex;
  renderMockScenarioStatus(note || "On-chain MOCK feed updated.");
  log(`MOCK moved to step ${safeIndex + 1} (${candle.date}, ${candle.price}).`);
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
    renderRoleHints();
    log(`Loaded deployment addresses from ${deploymentResult.fileName}.`);
  }

  log(`Wallet connected: ${state.account}`);
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
  log(`Contracts loaded. Settlement asset: ${state.tokenSymbol} (${assetAddress})`);
  await scheduleAdminLiveChartRefresh();
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
el.monitorSymbol.addEventListener("change", () => run(scheduleAdminLiveChartRefresh));
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
