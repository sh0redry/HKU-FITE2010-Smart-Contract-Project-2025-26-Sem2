import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.15.0/+esm";

export const NETWORK_CONFIGS = {
  31337: {
    name: "Hardhat Localhost",
    deploymentFile: "localhost.json",
    explorerBaseUrl: ""
  },
  11155111: {
    name: "Sepolia",
    deploymentFile: "sepolia.json",
    explorerBaseUrl: "https://sepolia.etherscan.io/address/"
  },
  84532: {
    name: "Base Sepolia",
    deploymentFile: "base-sepolia.json",
    explorerBaseUrl: "https://sepolia.basescan.org/address/"
  }
};

export const policyFactoryAbi = [
  "error InvalidAddress()",
  "error InvalidAmount()",
  "error UnsupportedSymbol(bytes32 symbol)",
  "error PolicyNotActive()",
  "error PolicyNotExpired()",
  "error PolicyExpired()",
  "error CancellationLocked()",
  "error NotPolicyHolder()",
  "error UnderwritingPaused(bytes32 reason)",
  "error SymbolExposureLimitExceeded(bytes32 symbol)",
  "error DirectionExposureLimitExceeded(bool isDownsideProtection)",
  "error TermBucketExposureLimitExceeded(uint8 bucket)",
  "error UtilizationRiskExceeded()",
  "error SolvencyCheckFailed()",
  "error EnforcedPause()",
  "function paused() view returns (bool)",
  "function underwritingPaused() view returns (bool)",
  "function getActivePoliciesCount() view returns (uint256)",
  "function maxUtilizationBps() view returns (uint256)",
  "function emergencyPauseUtilizationBps() view returns (uint256)",
  "function minimumLiquidityBuffer() view returns (uint256)",
  "function maxDownsideExposure() view returns (uint256)",
  "function maxUpsideExposure() view returns (uint256)",
  "function maxShortTermExposure() view returns (uint256)",
  "function maxMediumTermExposure() view returns (uint256)",
  "function maxLongTermExposure() view returns (uint256)",
  "function downsideExposure() view returns (uint256)",
  "function upsideExposure() view returns (uint256)",
  "function shortTermExposure() view returns (uint256)",
  "function mediumTermExposure() view returns (uint256)",
  "function longTermExposure() view returns (uint256)",
  "function symbolExposure(bytes32 symbol) view returns (uint256)",
  "function symbolExposureLimit(bytes32 symbol) view returns (uint256)",
  "function previewPolicy(bytes32 symbol, bool isDownsideProtection, uint256 notional, uint256 duration, uint16 triggerBps, uint256 deductible, uint256 payoutCap) view returns ((uint256 premium, uint256 spotPrice, uint256 strikePrice, uint256 notional, uint256 deductible, uint256 payoutCap, uint256 annualVolBps, uint256 estimatedProbabilityBps, uint256 termStructureMultiplierBps, uint256 directionalRiskBps, uint256 inventoryPressureBps, uint256 stressPremiumBps, uint256 riskScoreBps, uint256 utilizationSurchargeBps, uint256 overnightGapSurchargeBps, uint256 oracleUpdatedAt, uint16 triggerBps, bool isDownsideProtection, bool oracleUsedFallback, bool settlesAtNextOpen, uint256 expiry, uint256 effectiveSettlementTime, bytes32 oracleSourceTag))",
  "function purchasePolicy(bytes32 symbol, bool isDownsideProtection, uint256 notional, uint256 duration, uint16 triggerBps, uint256 deductible, uint256 payoutCap) returns (uint256)",
  "function settlePolicy(uint256 policyId)",
  "function cancelPolicy(uint256 policyId)",
  "function getPoliciesByHolder(address holder) view returns (uint256[])",
  "function getPolicy(uint256 policyId) view returns ((uint256 id, address holder, bytes32 symbol, bool isDownsideProtection, uint16 triggerBps, uint256 strikePrice, uint256 notional, uint256 deductible, uint256 payoutCap, uint256 premiumPaid, uint256 entryPrice, uint256 exitPrice, uint256 createdAt, uint256 expiry, uint256 settledAt, uint256 reservedLiquidity, uint256 payoutAmount, uint8 status))",
  "function configureRiskLimits(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
  "function setSymbolExposureLimit(bytes32 symbol, uint256 newLimit)",
  "function setUnderwritingPaused(bool paused, bytes32 reason)",
  "function unpauseUnderwriting()"
];

export const vaultAbi = [
  "error InvalidAddress()",
  "error InvalidAmount()",
  "error InsufficientLiquidity()",
  "error Reentrancy()",
  "error TokenTransferFailed()",
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

export const oracleAbi = [
  "error MarketInactive(bytes32 symbol)",
  "error InvalidDuration()",
  "error NotionalTooLarge()",
  "error InvalidUtilization()",
  "error InvalidTrigger()",
  "error InvalidPayoutTerms()",
  "error MarketClosed(bytes32 symbol)",
  "error MarketClosingSoon(bytes32 symbol)",
  "error InvalidRiskProvider()",
  "error InvalidOracleAdapter()",
  "error MissingRiskSnapshot(bytes32 symbol)",
  "error SettlementPricePending(bytes32 symbol, uint256 effectiveTimestamp)",
  "error OracleUnavailable(bytes32 symbol)",
  "error FallbackOracleDisabled(bytes32 symbol)",
  "error EnforcedPause()",
  "function paused() view returns (bool)",
  "function riskParameterProvider() view returns (address)",
  "function oracleAdapter() view returns (address)",
  "function isMarketOpen(bytes32 symbol) view returns (bool)",
  "function getSpotPrice(bytes32 symbol) view returns (uint256)",
  "function getSettlementPrice(bytes32 symbol, uint256 scheduledExpiry) view returns (uint256 price, uint256 effectiveTimestamp)",
  "function getSessionWindow(bytes32 symbol, uint256 timestamp) view returns (bool,bool,uint256,uint256,uint256,uint256,uint256)",
  "function configureMarket(bytes32 symbol, (uint256 minDuration,uint256 maxDuration,uint256 basePremiumBps,uint256 maxNotional,uint16 minTriggerBps,uint16 maxTriggerBps,uint16 openMinutesLocal,uint16 closeMinutesLocal,uint16 closeBufferMinutes,uint16 overnightGapSurchargeBps,bool enforceMarketHours,bool allowFallbackOracle,uint8 settlementMode,uint8 calendarType,bool isActive) config)",
  "function setCalendarClosure(uint8 calendarType, uint256 dateKey, bool isClosed)",
  "function setRiskParameterProvider(address newProvider)",
  "function setOracleAdapter(address newAdapter)",
  "function pauseQuoting()",
  "function unpauseQuoting()"
];

export const erc20Abi = [
  "error InsufficientBalance()",
  "error InsufficientAllowance()",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

export const mockPriceFeedAbi = [
  "function setAnswer(int256 newAnswer)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
];

export const policyFactoryInterface = new ethers.Interface(policyFactoryAbi);
export const oracleInterface = new ethers.Interface(oracleAbi);
export const vaultInterface = new ethers.Interface(vaultAbi);
export const erc20Interface = new ethers.Interface(erc20Abi);

export function decodeBytes32(value) {
  try {
    return ethers.decodeBytes32String(value).replace(/\u0000/g, "");
  } catch {
    return value;
  }
}

export function policyStatusLabel(policy, nowTimestamp) {
  const now = BigInt(nowTimestamp);
  if (Number(policy.status) === 1) return "Settled";
  if (Number(policy.status) === 2) return "Cancelled";
  return now >= policy.expiry ? "Expired" : "Active";
}

function normalizeArg(value) {
  if (typeof value === "string" && value.startsWith("0x") && value.length === 66) {
    return decodeBytes32(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return String(value);
}

function extractErrorData(error) {
  const visited = new Set();
  const queue = [error];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || visited.has(current)) {
      continue;
    }
    visited.add(current);

    const directCandidates = [current.data, current.error?.data, current.info?.error?.data];
    for (const candidate of directCandidates) {
      if (typeof candidate === "string" && candidate.startsWith("0x")) {
        return candidate;
      }
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return null;
}

export function decodeError(error, interfaces = []) {
  const rawData = extractErrorData(error);
  if (rawData) {
    for (const iface of interfaces) {
      try {
        const parsed = iface.parseError(rawData);
        if (!parsed) continue;
        const args = parsed.args ? Array.from(parsed.args).map(normalizeArg) : [];
        return args.length > 0 ? `${parsed.name}: ${args.join(", ")}` : parsed.name;
      } catch {
        // Keep trying other interfaces.
      }
    }
  }

  return error?.shortMessage || error?.reason || error?.message || "Unknown error";
}

export async function detectNetwork(provider) {
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const config = NETWORK_CONFIGS[chainId] || {
    name: network.name || `Chain ${chainId}`,
    deploymentFile: null,
    explorerBaseUrl: ""
  };

  return {
    chainId,
    chainName: config.name,
    deploymentFile: config.deploymentFile,
    explorerBaseUrl: config.explorerBaseUrl
  };
}

export async function loadDeploymentByChain(chainId) {
  const config = NETWORK_CONFIGS[chainId];
  if (!config?.deploymentFile || !window.location.protocol.startsWith("http")) {
    return null;
  }

  const response = await fetch(`./deployments/${config.deploymentFile}`);
  if (!response.ok) {
    return null;
  }

  const deployment = await response.json();
  return {
    deployment,
    fileName: config.deploymentFile
  };
}
