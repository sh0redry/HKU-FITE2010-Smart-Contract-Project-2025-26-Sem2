import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";

const state = {
  provider: null,
  signer: null,
  account: null,
  tokenDecimals: 6,
  tokenSymbol: "USDC",
  contracts: {}
};

const policyFactoryAbi = [
  "function previewPolicy(bytes32 symbol, bool isDownsideProtection, uint256 notional, uint256 duration, uint16 triggerBps, uint256 deductible, uint256 payoutCap) view returns ((uint256 premium, uint256 spotPrice, uint256 strikePrice, uint256 notional, uint256 deductible, uint256 payoutCap, uint256 annualVolBps, uint256 estimatedProbabilityBps, uint256 termStructureMultiplierBps, uint256 directionalRiskBps, uint256 inventoryPressureBps, uint256 stressPremiumBps, uint256 riskScoreBps, uint256 utilizationSurchargeBps, uint256 overnightGapSurchargeBps, uint16 triggerBps, bool isDownsideProtection, bool settlesAtNextOpen, uint256 expiry, uint256 effectiveSettlementTime))",
  "function purchasePolicy(bytes32 symbol, bool isDownsideProtection, uint256 notional, uint256 duration, uint16 triggerBps, uint256 deductible, uint256 payoutCap) returns (uint256)",
  "function settlePolicy(uint256 policyId)",
  "function cancelPolicy(uint256 policyId)",
  "function getPoliciesByHolder(address holder) view returns (uint256[])",
  "function getPolicy(uint256 policyId) view returns ((uint256 id, address holder, bytes32 symbol, bool isDownsideProtection, uint16 triggerBps, uint256 strikePrice, uint256 notional, uint256 deductible, uint256 payoutCap, uint256 premiumPaid, uint256 entryPrice, uint256 exitPrice, uint256 createdAt, uint256 expiry, uint256 settledAt, uint256 reservedLiquidity, uint256 payoutAmount, uint8 status))"
];

const vaultAbi = [
  "function settlementAsset() view returns (address)",
  "function deposit(uint256 assetAmount) returns (uint256 sharesMinted)",
  "function withdraw(uint256 shareAmount) returns (uint256 assetsOut)",
  "function totalAssets() view returns (uint256)",
  "function totalReserved() view returns (uint256)",
  "function utilizationBps() view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function shareBalance(address account) view returns (uint256)",
  "function realizedPremiums() view returns (uint256)",
  "function totalClaimsPaid() view returns (uint256)",
  "function sharePrice() view returns (uint256)",
  "function netUnderwritingResult() view returns (int256)"
];

const oracleAbi = [
  "function isMarketOpen(bytes32 symbol) view returns (bool)",
  "function getSpotPrice(bytes32 symbol) view returns (uint256)",
  "function getSettlementPrice(bytes32 symbol, uint256 scheduledExpiry) view returns (uint256 price, uint256 effectiveTimestamp)"
];

const erc20Abi = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const el = {
  connectButton: document.getElementById("connectButton"),
  walletStatus: document.getElementById("walletStatus"),
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
  settlePolicyIdInput: document.getElementById("settlePolicyIdInput"),
  settleButton: document.getElementById("settleButton"),
  cancelPolicyIdInput: document.getElementById("cancelPolicyIdInput"),
  cancelButton: document.getElementById("cancelButton"),
  loadPoliciesButton: document.getElementById("loadPoliciesButton"),
  policiesOutput: document.getElementById("policiesOutput"),
  depositInput: document.getElementById("depositInput"),
  depositButton: document.getElementById("depositButton"),
  withdrawInput: document.getElementById("withdrawInput"),
  withdrawButton: document.getElementById("withdrawButton"),
  vaultStateButton: document.getElementById("vaultStateButton"),
  vaultOutput: document.getElementById("vaultOutput"),
  logOutput: document.getElementById("logOutput")
};

function log(message) {
  el.logOutput.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n${el.logOutput.textContent}`;
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

async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("MetaMask or another injected wallet is required.");
  }

  state.provider = new ethers.BrowserProvider(window.ethereum);
  await state.provider.send("eth_requestAccounts", []);
  state.signer = await state.provider.getSigner();
  state.account = await state.signer.getAddress();
  el.walletStatus.textContent = `Connected: ${state.account}`;
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
  log(`Contracts loaded. Settlement asset: ${state.tokenSymbol} (${assetAddress})`);
}

async function ensureAllowance(spender, requiredAmount) {
  const allowance = await state.contracts.token.allowance(state.account, spender);
  if (allowance >= requiredAmount) {
    return;
  }

  const tx = await state.contracts.token.approve(spender, ethers.MaxUint256);
  log(`Approval submitted: ${tx.hash}`);
  await tx.wait();
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

  el.quoteOutput.textContent =
    `premium: ${formatToken(quote.premium)}\n` +
    `spotPrice: ${ethers.formatUnits(quote.spotPrice, 18)} USD\n` +
    `strikePrice: ${ethers.formatUnits(quote.strikePrice, 18)} USD\n` +
    `estimatedProbabilityBps: ${quote.estimatedProbabilityBps}\n` +
    `annualVolBps: ${quote.annualVolBps}\n` +
    `termStructureMultiplierBps: ${quote.termStructureMultiplierBps}\n` +
    `directionalRiskBps: ${quote.directionalRiskBps}\n` +
    `inventoryPressureBps: ${quote.inventoryPressureBps}\n` +
    `stressPremiumBps: ${quote.stressPremiumBps}\n` +
    `riskScoreBps: ${quote.riskScoreBps}\n` +
    `utilizationSurchargeBps: ${quote.utilizationSurchargeBps}\n` +
    `overnightGapSurchargeBps: ${quote.overnightGapSurchargeBps}\n` +
    `settlesAtNextOpen: ${quote.settlesAtNextOpen}\n` +
    `expiry: ${new Date(Number(quote.expiry) * 1000).toLocaleString()}\n` +
    `effectiveSettlementTime: ${new Date(Number(quote.effectiveSettlementTime) * 1000).toLocaleString()}\n` +
    `marketOpen: ${marketOpen}`;

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

  log(`Purchase submitted: ${tx.hash}`);
  await tx.wait();
  log("Policy purchased.");
}

async function settlePolicy() {
  requireWallet();
  requireContracts();

  const policyId = BigInt(el.settlePolicyIdInput.value);
  const tx = await state.contracts.policyFactory.settlePolicy(policyId);
  log(`Settlement submitted: ${tx.hash}`);
  await tx.wait();
  log(`Policy ${policyId} settled.`);
}

async function cancelPolicy() {
  requireWallet();
  requireContracts();

  const policyId = BigInt(el.cancelPolicyIdInput.value);
  const tx = await state.contracts.policyFactory.cancelPolicy(policyId);
  log(`Cancellation submitted: ${tx.hash}`);
  await tx.wait();
  log(`Policy ${policyId} cancelled.`);
}

async function loadPolicies() {
  requireWallet();
  requireContracts();

  const policyIds = await state.contracts.policyFactory.getPoliciesByHolder(state.account);
  if (policyIds.length === 0) {
    el.policiesOutput.textContent = "No policies for current wallet.";
    return;
  }

  const rows = [];
  for (const id of policyIds) {
    const policy = await state.contracts.policyFactory.getPolicy(id);
    rows.push({
      id: policy.id.toString(),
      symbol: ethers.decodeBytes32String(policy.symbol),
      side: policy.isDownsideProtection ? "downside" : "upside",
      triggerPct: `${Number(policy.triggerBps) / 100}%`,
      strikePrice: ethers.formatUnits(policy.strikePrice, 18),
      notional: ethers.formatUnits(policy.notional, state.tokenDecimals),
      deductible: ethers.formatUnits(policy.deductible, state.tokenDecimals),
      payoutCap: ethers.formatUnits(policy.payoutCap, state.tokenDecimals),
      premium: ethers.formatUnits(policy.premiumPaid, state.tokenDecimals),
      entryPrice: ethers.formatUnits(policy.entryPrice, 18),
      exitPrice: ethers.formatUnits(policy.exitPrice, 18),
      createdAt: new Date(Number(policy.createdAt) * 1000).toLocaleString(),
      expiry: new Date(Number(policy.expiry) * 1000).toLocaleString(),
      settledAt: policy.settledAt === 0n ? null : new Date(Number(policy.settledAt) * 1000).toLocaleString(),
      payout: ethers.formatUnits(policy.payoutAmount, state.tokenDecimals),
      status: Number(policy.status)
    });
  }

  el.policiesOutput.textContent = JSON.stringify(rows, null, 2);
  log("Loaded holder policies.");
}

async function depositLiquidity() {
  requireWallet();
  requireContracts();

  const amount = parseTokenInput(el.depositInput.value);
  await ensureAllowance(await state.contracts.vault.getAddress(), amount);
  const tx = await state.contracts.vault.deposit(amount);
  log(`Deposit submitted: ${tx.hash}`);
  await tx.wait();
  log("Liquidity deposited.");
}

async function withdrawLiquidity() {
  requireWallet();
  requireContracts();

  const shareAmount = parseTokenInput(el.withdrawInput.value);
  const tx = await state.contracts.vault.withdraw(shareAmount);
  log(`Withdraw submitted: ${tx.hash}`);
  await tx.wait();
  log("Liquidity withdrawn.");
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

  el.vaultOutput.textContent =
    `walletBalance: ${formatToken(tokenBalance)}\n` +
    `totalAssets: ${formatToken(totalAssets)}\n` +
    `totalReserved: ${formatToken(totalReserved)}\n` +
    `availableLiquidity: ${formatToken(availableLiquidity)}\n` +
    `utilizationBps: ${utilizationBps}\n` +
    `totalShares: ${ethers.formatUnits(totalShares, state.tokenDecimals)}\n` +
    `myShares: ${ethers.formatUnits(userShares, state.tokenDecimals)}\n` +
    `realizedPremiums: ${formatToken(realizedPremiums)}\n` +
    `totalClaimsPaid: ${formatToken(totalClaimsPaid)}\n` +
    `sharePrice: ${ethers.formatUnits(sharePrice, 18)}\n` +
    `netUnderwritingResult: ${netUnderwritingResult}`;

  log("Vault state refreshed.");
}

async function run(action) {
  try {
    await action();
  } catch (error) {
    const reason = error?.shortMessage || error?.reason || error?.message || "Unknown error";
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

  const response = await fetch("./deployments/localhost.json");
  if (!response.ok) {
    return;
  }

  const deployment = await response.json();
  el.policyFactoryAddress.value = deployment.contracts.policyFactory;
  el.vaultAddress.value = deployment.contracts.insuranceVault;
  el.oracleAddress.value = deployment.contracts.pricingOracle;
  log("Loaded local deployment addresses from frontend/deployments/localhost.json.");
});
