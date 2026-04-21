import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";

const state = {
  provider: null,
  signer: null,
  account: null,
  contracts: {}
};

const policyFactoryAbi = [
  "function previewPolicy(bytes32 symbol, bool isDownsideProtection, uint256 coverageAmount, uint256 duration) view returns ((uint256 premium, uint256 spotPrice, uint256 annualVolBps, uint256 utilizationSurchargeBps, uint256 expiry))",
  "function purchasePolicy(bytes32 symbol, bool isDownsideProtection, uint256 coverageAmount, uint256 duration) payable returns (uint256)",
  "function settlePolicy(uint256 policyId)",
  "function getPoliciesByHolder(address holder) view returns (uint256[])",
  "function getPolicy(uint256 policyId) view returns ((uint256 id, address holder, bytes32 symbol, bool isDownsideProtection, uint256 coverageAmount, uint256 premiumPaid, uint256 entryPrice, uint256 exitPrice, uint256 startedAt, uint256 expiry, uint256 reservedLiquidity, uint256 payoutAmount, uint8 status))"
];

const vaultAbi = [
  "function deposit() payable returns (uint256 sharesMinted)",
  "function withdraw(uint256 shareAmount) returns (uint256 assetsOut)",
  "function totalAssets() view returns (uint256)",
  "function totalReserved() view returns (uint256)",
  "function utilizationBps() view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function shareBalance(address account) view returns (uint256)"
];

const oracleAbi = [
  "function isMarketOpen(bytes32 symbol) view returns (bool)",
  "function getSpotPrice(bytes32 symbol) view returns (uint256)"
];

const el = {
  connectButton: document.getElementById("connectButton"),
  walletStatus: document.getElementById("walletStatus"),
  saveAddressesButton: document.getElementById("saveAddressesButton"),
  policyFactoryAddress: document.getElementById("policyFactoryAddress"),
  vaultAddress: document.getElementById("vaultAddress"),
  oracleAddress: document.getElementById("oracleAddress"),
  symbolInput: document.getElementById("symbolInput"),
  coverageInput: document.getElementById("coverageInput"),
  durationInput: document.getElementById("durationInput"),
  directionInput: document.getElementById("directionInput"),
  quoteButton: document.getElementById("quoteButton"),
  buyButton: document.getElementById("buyButton"),
  quoteOutput: document.getElementById("quoteOutput"),
  settlePolicyIdInput: document.getElementById("settlePolicyIdInput"),
  settleButton: document.getElementById("settleButton"),
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

function parseEthInput(value) {
  return ethers.parseEther(String(value || "0"));
}

function parseDurationHours(value) {
  return BigInt(Math.floor(Number(value)) * 3600);
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

function loadContracts() {
  requireWallet();

  const factoryAddress = el.policyFactoryAddress.value.trim();
  const vaultAddress = el.vaultAddress.value.trim();
  const oracleAddress = el.oracleAddress.value.trim();

  state.contracts.policyFactory = new ethers.Contract(factoryAddress, policyFactoryAbi, state.signer);
  state.contracts.vault = new ethers.Contract(vaultAddress, vaultAbi, state.signer);
  state.contracts.oracle = new ethers.Contract(oracleAddress, oracleAbi, state.signer);

  log("Contracts loaded.");
}

async function getQuote() {
  requireWallet();
  requireContracts();

  const symbol = toSymbolBytes32(el.symbolInput.value);
  const coverageAmount = parseEthInput(el.coverageInput.value);
  const duration = parseDurationHours(el.durationInput.value);
  const isDownsideProtection = el.directionInput.value === "down";

  const [quote, marketOpen] = await Promise.all([
    state.contracts.policyFactory.previewPolicy(symbol, isDownsideProtection, coverageAmount, duration),
    state.contracts.oracle.isMarketOpen(symbol)
  ]);

  el.quoteOutput.textContent =
    `premium: ${ethers.formatEther(quote.premium)} ETH\n` +
    `spotPrice: ${ethers.formatUnits(quote.spotPrice, 18)} USD\n` +
    `annualVolBps: ${quote.annualVolBps}\n` +
    `utilizationSurchargeBps: ${quote.utilizationSurchargeBps}\n` +
    `expiry: ${new Date(Number(quote.expiry) * 1000).toLocaleString()}\n` +
    `marketOpen: ${marketOpen}`;

  log("Quote refreshed.");
  return quote;
}

async function buyPolicy() {
  requireWallet();
  requireContracts();

  const quote = await getQuote();
  const symbol = toSymbolBytes32(el.symbolInput.value);
  const coverageAmount = parseEthInput(el.coverageInput.value);
  const duration = parseDurationHours(el.durationInput.value);
  const isDownsideProtection = el.directionInput.value === "down";

  const tx = await state.contracts.policyFactory.purchasePolicy(
    symbol,
    isDownsideProtection,
    coverageAmount,
    duration,
    { value: quote.premium }
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
      downside: policy.isDownsideProtection,
      coverageEth: ethers.formatEther(policy.coverageAmount),
      premiumEth: ethers.formatEther(policy.premiumPaid),
      entryPrice: ethers.formatUnits(policy.entryPrice, 18),
      exitPrice: ethers.formatUnits(policy.exitPrice, 18),
      expiry: new Date(Number(policy.expiry) * 1000).toLocaleString(),
      payoutEth: ethers.formatEther(policy.payoutAmount),
      status: Number(policy.status)
    });
  }

  el.policiesOutput.textContent = JSON.stringify(rows, null, 2);
  log("Loaded holder policies.");
}

async function depositLiquidity() {
  requireWallet();
  requireContracts();

  const amount = parseEthInput(el.depositInput.value);
  const tx = await state.contracts.vault.deposit({ value: amount });
  log(`Deposit submitted: ${tx.hash}`);
  await tx.wait();
  log("Liquidity deposited.");
}

async function withdrawLiquidity() {
  requireWallet();
  requireContracts();

  const shareAmount = parseEthInput(el.withdrawInput.value);
  const tx = await state.contracts.vault.withdraw(shareAmount);
  log(`Withdraw submitted: ${tx.hash}`);
  await tx.wait();
  log("Liquidity withdrawn.");
}

async function refreshVaultState() {
  requireWallet();
  requireContracts();

  const [totalAssets, totalReserved, utilizationBps, availableLiquidity, totalShares, userShares] = await Promise.all([
    state.contracts.vault.totalAssets(),
    state.contracts.vault.totalReserved(),
    state.contracts.vault.utilizationBps(),
    state.contracts.vault.availableLiquidity(),
    state.contracts.vault.totalShares(),
    state.contracts.vault.shareBalance(state.account)
  ]);

  el.vaultOutput.textContent =
    `totalAssets: ${ethers.formatEther(totalAssets)} ETH\n` +
    `totalReserved: ${ethers.formatEther(totalReserved)} ETH\n` +
    `availableLiquidity: ${ethers.formatEther(availableLiquidity)} ETH\n` +
    `utilizationBps: ${utilizationBps}\n` +
    `totalShares: ${ethers.formatEther(totalShares)}\n` +
    `myShares: ${ethers.formatEther(userShares)}`;

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
el.saveAddressesButton.addEventListener("click", () => run(async () => loadContracts()));
el.quoteButton.addEventListener("click", () => run(getQuote));
el.buyButton.addEventListener("click", () => run(buyPolicy));
el.settleButton.addEventListener("click", () => run(settlePolicy));
el.loadPoliciesButton.addEventListener("click", () => run(loadPolicies));
el.depositButton.addEventListener("click", () => run(depositLiquidity));
el.withdrawButton.addEventListener("click", () => run(withdrawLiquidity));
el.vaultStateButton.addEventListener("click", () => run(refreshVaultState));
