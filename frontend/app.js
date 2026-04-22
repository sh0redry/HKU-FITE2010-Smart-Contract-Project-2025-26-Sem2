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
  lastPolicies: []
};

const STATUS_COLORS = {
  Active: "#d87c40",
  Expired: "#c98b2d",
  Settled: "#2f8f57",
  Cancelled: "#8e6a53"
};

const el = {
  connectButton: document.getElementById("connectButton"),
  walletStatus: document.getElementById("walletStatus"),
  networkBadge: document.getElementById("networkBadge"),
  deploymentStatus: document.getElementById("deploymentStatus"),
  txFeedback: document.getElementById("txFeedback"),
  saveAddressesButton: document.getElementById("saveAddressesButton"),
  policyFactoryAddress: document.getElementById("policyFactoryAddress"),
  vaultAddress: document.getElementById("vaultAddress"),
  oracleAddress: document.getElementById("oracleAddress"),
  symbolInput: document.getElementById("symbolInput"),
  notionalInput: document.getElementById("notionalInput"),
  durationInput: document.getElementById("durationInput"),
  directionInput: document.getElementById("directionInput"),
  triggerInput: document.getElementById("triggerInput"),
  deductibleInput: document.getElementById("deductibleInput"),
  payoutCapInput: document.getElementById("payoutCapInput"),
  quoteButton: document.getElementById("quoteButton"),
  buyButton: document.getElementById("buyButton"),
  quoteOutput: document.getElementById("quoteOutput"),
  quoteKpis: document.getElementById("quoteKpis"),
  quoteBreakdownChart: document.getElementById("quoteBreakdownChart"),
  priceRiskChart: document.getElementById("priceRiskChart"),
  settlePolicyIdInput: document.getElementById("settlePolicyIdInput"),
  settleButton: document.getElementById("settleButton"),
  cancelPolicyIdInput: document.getElementById("cancelPolicyIdInput"),
  cancelButton: document.getElementById("cancelButton"),
  loadPoliciesButton: document.getElementById("loadPoliciesButton"),
  policiesOutput: document.getElementById("policiesOutput"),
  policySummary: document.getElementById("policySummary"),
  policiesTableBody: document.getElementById("policiesTableBody"),
  depositInput: document.getElementById("depositInput"),
  depositButton: document.getElementById("depositButton"),
  withdrawInput: document.getElementById("withdrawInput"),
  withdrawButton: document.getElementById("withdrawButton"),
  vaultStateButton: document.getElementById("vaultStateButton"),
  vaultOutput: document.getElementById("vaultOutput"),
  lpSummary: document.getElementById("lpSummary"),
  lpYieldChart: document.getElementById("lpYieldChart"),
  logOutput: document.getElementById("logOutput")
};

function log(message) {
  el.logOutput.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n${el.logOutput.textContent}`;
}

function showFeedback(kind, title, detail, txHash = "") {
  const colorClass = kind === "error" ? "feedback-error" : kind === "success" ? "feedback-success" : "feedback-info";
  const explorer =
    txHash && state.network?.explorerBaseUrl
      ? `<a href="${state.network.explorerBaseUrl}${txHash}" target="_blank" rel="noreferrer">View tx</a>`
      : txHash
        ? `<span>${txHash}</span>`
        : "";

  el.txFeedback.innerHTML = `
    <div class="feedback ${colorClass}">
      <strong>${title}</strong>
      <span>${detail}</span>
      ${explorer}
    </div>
  `;
}

function requireWallet() {
  if (!state.signer) {
    throw new Error("Connect a wallet first.");
  }
}

function requireContracts() {
  if (!state.contracts.policyFactory || !state.contracts.vault || !state.contracts.oracle) {
    throw new Error("Load contract addresses first.");
  }
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
  return `${ethers.formatUnits(value, 18)} USD`;
}

function renderPills(container, items) {
  container.innerHTML = "";
  for (const item of items) {
    const span = document.createElement("span");
    span.className = "pill";
    span.textContent = item;
    container.appendChild(span);
  }
}

function drawBarChart(canvas, items) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const filtered = items.filter((item) => item.value > 0);
  if (filtered.length === 0) {
    ctx.fillStyle = "#fdf2e4";
    ctx.font = "14px sans-serif";
    ctx.fillText("No chart data yet.", 16, 30);
    return;
  }

  const maxValue = Math.max(...filtered.map((item) => item.value));
  filtered.forEach((item, index) => {
    const y = 24 + index * 34;
    const barWidth = Math.max((item.value / maxValue) * (width - 180), 6);
    ctx.fillStyle = item.color;
    ctx.fillRect(140, y, barWidth, 18);
    ctx.fillStyle = "#fdf2e4";
    ctx.font = "13px sans-serif";
    ctx.fillText(item.label, 12, y + 14);
    ctx.fillText(item.display, 150 + barWidth, y + 14);
  });
}

function drawPriceChart(canvas, quote) {
  if (!canvas || !quote) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const spot = Number(ethers.formatUnits(quote.spotPrice, 18));
  const strike = Number(ethers.formatUnits(quote.strikePrice, 18));
  const low = Math.min(spot, strike) * 0.9;
  const high = Math.max(spot, strike) * 1.1;
  const scale = (value) => 30 + ((value - low) / (high - low || 1)) * (width - 60);

  ctx.strokeStyle = "#f7d9bf";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(30, height / 2);
  ctx.lineTo(width - 30, height / 2);
  ctx.stroke();

  ctx.fillStyle = "#de7c2d";
  const spotX = scale(spot);
  ctx.beginPath();
  ctx.arc(spotX, height / 2, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fdf2e4";
  ctx.fillText(`Spot ${spot.toFixed(2)}`, Math.min(spotX + 10, width - 110), height / 2 - 12);

  ctx.fillStyle = "#6ec28b";
  const strikeX = scale(strike);
  ctx.fillRect(strikeX - 3, height / 2 - 28, 6, 56);
  ctx.fillStyle = "#fdf2e4";
  ctx.fillText(`Strike ${strike.toFixed(2)}`, Math.min(strikeX + 10, width - 110), height / 2 + 22);

  ctx.fillStyle = "#fdf2e4";
  ctx.font = "12px sans-serif";
  ctx.fillText(`Vol ${quote.annualVolBps / 100}%`, 16, height - 16);
  ctx.fillText(`Prob ${quote.estimatedProbabilityBps / 100}%`, width - 120, height - 16);
}

function renderNetworkStatus() {
  if (!state.network) {
    el.networkBadge.textContent = "No network";
    el.deploymentStatus.textContent = "Connect a wallet to detect the current network.";
    return;
  }

  el.networkBadge.textContent = `${state.network.chainName} (${state.network.chainId})`;
  el.deploymentStatus.textContent = state.deploymentFile
    ? `Deployment source: ${state.deploymentFile}`
    : "No deployment file found for this network yet. You can still paste contract addresses manually.";
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
  el.walletStatus.textContent = `Connected: ${state.account}`;
  renderNetworkStatus();

  const deploymentResult = await loadDeploymentByChain(state.network.chainId);
  if (deploymentResult) {
    state.deployment = deploymentResult.deployment;
    state.deploymentFile = deploymentResult.fileName;
    el.policyFactoryAddress.value = deploymentResult.deployment.contracts.policyFactory;
    el.vaultAddress.value = deploymentResult.deployment.contracts.insuranceVault;
    el.oracleAddress.value = deploymentResult.deployment.contracts.pricingOracle;
    renderNetworkStatus();
    log(`Loaded deployment addresses from ${deploymentResult.fileName}.`);
  } else {
    state.deployment = null;
    state.deploymentFile = null;
    renderNetworkStatus();
  }

  log(`Wallet connected: ${state.account}`);
}

async function loadContracts() {
  requireWallet();

  state.contracts.policyFactory = new ethers.Contract(el.policyFactoryAddress.value.trim(), policyFactoryAbi, state.signer);
  state.contracts.vault = new ethers.Contract(el.vaultAddress.value.trim(), vaultAbi, state.signer);
  state.contracts.oracle = new ethers.Contract(el.oracleAddress.value.trim(), oracleAbi, state.signer);

  const assetAddress = await state.contracts.vault.settlementAsset();
  state.contracts.token = new ethers.Contract(assetAddress, erc20Abi, state.signer);
  state.tokenDecimals = Number(await state.contracts.token.decimals());
  state.tokenSymbol = await state.contracts.token.symbol();

  renderNetworkStatus();
  showFeedback("success", "Contracts loaded", `Settlement asset: ${state.tokenSymbol} at ${assetAddress}`);
  log(`Contracts loaded. Settlement asset: ${state.tokenSymbol} (${assetAddress})`);
}

async function ensureAllowance(spender, requiredAmount) {
  const allowance = await state.contracts.token.allowance(state.account, spender);
  if (allowance >= requiredAmount) {
    return;
  }

  const tx = await state.contracts.token.approve(spender, ethers.MaxUint256);
  showFeedback("info", "Approval submitted", "Waiting for allowance confirmation.", tx.hash);
  log(`Approval submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Allowance ready", "Approval transaction confirmed.", tx.hash);
  log("Allowance approved.");
}

function currentQuoteInput() {
  return {
    symbol: toSymbolBytes32(el.symbolInput.value),
    notional: parseTokenInput(el.notionalInput.value),
    duration: parseDurationHours(el.durationInput.value),
    triggerBps: Number(el.triggerInput.value),
    deductible: parseTokenInput(el.deductibleInput.value),
    payoutCap: parseTokenInput(el.payoutCapInput.value),
    isDownsideProtection: el.directionInput.value === "down"
  };
}

function renderQuote(quote, marketOpen) {
  state.lastQuote = quote;

  el.quoteOutput.textContent =
    `premium: ${formatToken(quote.premium)}\n` +
    `spotPrice: ${formatUsd18(quote.spotPrice)}\n` +
    `strikePrice: ${formatUsd18(quote.strikePrice)}\n` +
    `estimatedProbabilityBps: ${quote.estimatedProbabilityBps}\n` +
    `oracleUpdatedAt: ${new Date(Number(quote.oracleUpdatedAt) * 1000).toLocaleString()}\n` +
    `effectiveSettlementTime: ${new Date(Number(quote.effectiveSettlementTime) * 1000).toLocaleString()}`;

  renderPills(el.quoteKpis, [
    `Premium ${formatToken(quote.premium)}`,
    `Spot ${ethers.formatUnits(quote.spotPrice, 18)} USD`,
    `Strike ${ethers.formatUnits(quote.strikePrice, 18)} USD`,
    `Vol ${Number(quote.annualVolBps) / 100}%`,
    `Probability ${Number(quote.estimatedProbabilityBps) / 100}%`,
    `Market ${marketOpen ? "Open" : "Closed"}`,
    `Fallback ${quote.oracleUsedFallback ? "Yes" : "No"}`,
    `Source ${decodeBytes32(quote.oracleSourceTag)}`
  ]);

  drawBarChart(el.quoteBreakdownChart, [
    {
      label: "Directional",
      value: Number(quote.directionalRiskBps),
      color: "#de7c2d",
      display: `${quote.directionalRiskBps} bps`
    },
    {
      label: "Inventory",
      value: Number(quote.inventoryPressureBps),
      color: "#d9a441",
      display: `${quote.inventoryPressureBps} bps`
    },
    {
      label: "Stress",
      value: Number(quote.stressPremiumBps),
      color: "#ad5f2d",
      display: `${quote.stressPremiumBps} bps`
    },
    {
      label: "Utilization",
      value: Number(quote.utilizationSurchargeBps),
      color: "#8ec96d",
      display: `${quote.utilizationSurchargeBps} bps`
    },
    {
      label: "Overnight",
      value: Number(quote.overnightGapSurchargeBps),
      color: "#59a2c3",
      display: `${quote.overnightGapSurchargeBps} bps`
    }
  ]);

  drawPriceChart(el.priceRiskChart, quote);
}

async function getQuote() {
  requireWallet();
  requireContracts();

  const input = currentQuoteInput();
  const [quote, marketOpen] = await Promise.all([
    state.contracts.policyFactory.previewPolicy(
      input.symbol,
      input.isDownsideProtection,
      input.notional,
      input.duration,
      input.triggerBps,
      input.deductible,
      input.payoutCap
    ),
    state.contracts.oracle.isMarketOpen(input.symbol)
  ]);

  renderQuote(quote, marketOpen);
  showFeedback("success", "Quote refreshed", `Premium ${formatToken(quote.premium)} | Market ${marketOpen ? "open" : "closed"}.`);
  log("Quote refreshed.");
  return quote;
}

async function buyPolicy() {
  requireWallet();
  requireContracts();

  const quote = await getQuote();
  const input = currentQuoteInput();

  await ensureAllowance(await state.contracts.vault.getAddress(), quote.premium);
  const tx = await state.contracts.policyFactory.purchasePolicy(
    input.symbol,
    input.isDownsideProtection,
    input.notional,
    input.duration,
    input.triggerBps,
    input.deductible,
    input.payoutCap
  );

  showFeedback("info", "Purchase submitted", "Waiting for policy mint confirmation.", tx.hash);
  log(`Purchase submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Policy purchased", `${el.symbolInput.value} coverage was created successfully.`, tx.hash);
  log("Policy purchased.");
  await Promise.all([loadPolicies(), refreshVaultState()]);
}

async function settlePolicy() {
  requireWallet();
  requireContracts();

  const policyId = BigInt(el.settlePolicyIdInput.value);
  const tx = await state.contracts.policyFactory.settlePolicy(policyId);
  showFeedback("info", "Settlement submitted", `Settling policy #${policyId}.`, tx.hash);
  log(`Settlement submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Policy settled", `Policy #${policyId} has been settled.`, tx.hash);
  log(`Policy ${policyId} settled.`);
  await Promise.all([loadPolicies(), refreshVaultState()]);
}

async function cancelPolicy() {
  requireWallet();
  requireContracts();

  const policyId = BigInt(el.cancelPolicyIdInput.value);
  const tx = await state.contracts.policyFactory.cancelPolicy(policyId);
  showFeedback("info", "Cancellation submitted", `Cancelling policy #${policyId}.`, tx.hash);
  log(`Cancellation submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Policy cancelled", `Policy #${policyId} has been cancelled.`, tx.hash);
  log(`Policy ${policyId} cancelled.`);
  await Promise.all([loadPolicies(), refreshVaultState()]);
}

function renderPolicyTable(rows) {
  el.policiesTableBody.innerHTML = "";
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8" class="table-empty">No policies for the connected wallet.</td>`;
    el.policiesTableBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>#${row.id}</td>
      <td>${row.symbol}</td>
      <td>${row.side}</td>
      <td><span class="status-dot" style="background:${STATUS_COLORS[row.statusLabel] || "#8e6a53"}"></span>${row.statusLabel}</td>
      <td>${row.expiryLabel}</td>
      <td>${row.notionalLabel}</td>
      <td>${row.premiumLabel}</td>
      <td>${row.payoutLabel}</td>
    `;
    el.policiesTableBody.appendChild(tr);
  }
}

async function loadPolicies() {
  requireWallet();
  requireContracts();

  const [policyIds, latestBlock] = await Promise.all([
    state.contracts.policyFactory.getPoliciesByHolder(state.account),
    state.provider.getBlock("latest")
  ]);
  const nowTimestamp = latestBlock.timestamp;

  if (policyIds.length === 0) {
    el.policiesOutput.textContent = "No policies for current wallet.";
    renderPills(el.policySummary, [
      "Active 0",
      "Expired 0",
      "Settled 0",
      "Cancelled 0"
    ]);
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
    counters[statusLabel] += 1;
    rows.push({
      id: policy.id.toString(),
      symbol: decodeBytes32(policy.symbol),
      side: policy.isDownsideProtection ? "Downside" : "Upside",
      statusLabel,
      expiryLabel: new Date(Number(policy.expiry) * 1000).toLocaleString(),
      notionalLabel: ethers.formatUnits(policy.notional, state.tokenDecimals),
      premiumLabel: ethers.formatUnits(policy.premiumPaid, state.tokenDecimals),
      payoutLabel: ethers.formatUnits(policy.payoutAmount, state.tokenDecimals),
      raw: policy
    });
  }

  state.lastPolicies = rows;
  renderPills(el.policySummary, [
    `Active ${counters.Active}`,
    `Expired ${counters.Expired}`,
    `Settled ${counters.Settled}`,
    `Cancelled ${counters.Cancelled}`
  ]);
  renderPolicyTable(rows);

  el.policiesOutput.textContent = JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      status: row.statusLabel,
      expiry: row.expiryLabel,
      notional: row.notionalLabel,
      premium: row.premiumLabel,
      payout: row.payoutLabel
    })),
    null,
    2
  );
  log("Loaded holder policies.");
}

async function depositLiquidity() {
  requireWallet();
  requireContracts();

  const amount = parseTokenInput(el.depositInput.value);
  await ensureAllowance(await state.contracts.vault.getAddress(), amount);
  const tx = await state.contracts.vault.deposit(amount);
  showFeedback("info", "Deposit submitted", `Depositing ${formatToken(amount)} to the vault.`, tx.hash);
  log(`Deposit submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Liquidity deposited", `${formatToken(amount)} deposited successfully.`, tx.hash);
  log("Liquidity deposited.");
  await refreshVaultState();
}

async function withdrawLiquidity() {
  requireWallet();
  requireContracts();

  const shareAmount = parseTokenInput(el.withdrawInput.value);
  const tx = await state.contracts.vault.withdraw(shareAmount);
  showFeedback("info", "Withdraw submitted", `Redeeming ${ethers.formatUnits(shareAmount, state.tokenDecimals)} shares.`, tx.hash);
  log(`Withdraw submitted: ${tx.hash}`);
  await tx.wait();
  showFeedback("success", "Liquidity withdrawn", "Vault withdrawal confirmed.", tx.hash);
  log("Liquidity withdrawn.");
  await refreshVaultState();
}

async function refreshVaultState() {
  requireWallet();
  requireContracts();

  const [
    totalAssets,
    totalReserved,
    utilizationBps,
    availableLiquidity,
    totalShares,
    userShares,
    realizedPremiums,
    totalClaimsPaid,
    sharePrice,
    netUnderwritingResult,
    tokenBalance
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

  const withdrawableAssets =
    totalShares === 0n ? 0n : (userShares * totalAssets) / totalShares;

  el.vaultOutput.textContent =
    `walletBalance: ${formatToken(tokenBalance)}\n` +
    `totalAssets: ${formatToken(totalAssets)}\n` +
    `totalReserved: ${formatToken(totalReserved)}\n` +
    `availableLiquidity: ${formatToken(availableLiquidity)}\n` +
    `utilizationBps: ${utilizationBps}\n` +
    `totalShares: ${ethers.formatUnits(totalShares, state.tokenDecimals)}\n` +
    `myShares: ${ethers.formatUnits(userShares, state.tokenDecimals)}\n` +
    `withdrawableAssets: ${formatToken(withdrawableAssets)}\n` +
    `realizedPremiums: ${formatToken(realizedPremiums)}\n` +
    `totalClaimsPaid: ${formatToken(totalClaimsPaid)}\n` +
    `sharePrice: ${ethers.formatUnits(sharePrice, 18)}\n` +
    `netUnderwritingResult: ${netUnderwritingResult}`;

  renderPills(el.lpSummary, [
    `TVL ${formatToken(totalAssets)}`,
    `Utilization ${Number(utilizationBps) / 100}%`,
    `Reserved ${formatToken(totalReserved)}`,
    `Available ${formatToken(availableLiquidity)}`,
    `My Shares ${ethers.formatUnits(userShares, state.tokenDecimals)}`,
    `Withdrawable ${formatToken(withdrawableAssets)}`,
    `P&L ${formatToken(realizedPremiums)} / ${formatToken(totalClaimsPaid)}`
  ]);

  drawBarChart(el.lpYieldChart, [
    { label: "Premiums", value: Number(realizedPremiums), color: "#de7c2d", display: formatToken(realizedPremiums) },
    { label: "Claims", value: Number(totalClaimsPaid), color: "#59a2c3", display: formatToken(totalClaimsPaid) },
    { label: "Reserved", value: Number(totalReserved), color: "#8e6a53", display: formatToken(totalReserved) }
  ]);

  log("Vault state refreshed.");
}

async function run(action) {
  try {
    await action();
  } catch (error) {
    const reason = decodeError(error, [
      policyFactoryInterface,
      oracleInterface,
      vaultInterface,
      erc20Interface
    ]);
    showFeedback("error", "Transaction failed", reason);
    log(`Error: ${reason}`);
  }
}

el.connectButton.addEventListener("click", () => run(connectWallet));
el.saveAddressesButton.addEventListener("click", () => run(loadContracts));
el.quoteButton.addEventListener("click", () => run(getQuote));
el.buyButton.addEventListener("click", () => run(buyPolicy));
el.settleButton.addEventListener("click", () => run(settlePolicy));
el.cancelButton.addEventListener("click", () => run(cancelPolicy));
el.loadPoliciesButton.addEventListener("click", () => run(loadPolicies));
el.depositButton.addEventListener("click", () => run(depositLiquidity));
el.withdrawButton.addEventListener("click", () => run(withdrawLiquidity));
el.vaultStateButton.addEventListener("click", () => run(refreshVaultState));

run(async () => {
  if (!window.location.protocol.startsWith("http")) {
    return;
  }

  el.deploymentStatus.textContent = "Connect a wallet to auto-load network-specific addresses.";
});
