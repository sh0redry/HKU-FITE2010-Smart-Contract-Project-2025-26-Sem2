// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IInsuranceVault.sol";
import "../interfaces/IPricingEngine.sol";

contract PolicyFactory {
    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_CANCEL_DELAY = 30 minutes;
    uint256 public constant SHORT_TERM_MAX = 7 days;
    uint256 public constant MEDIUM_TERM_MAX = 21 days;

    enum TermBucket {
        Short,
        Medium,
        Long
    }

    enum PolicyStatus {
        Active,
        Settled,
        Cancelled
    }

    struct Policy {
        uint256 id;
        address holder;
        bytes32 symbol;
        bool isDownsideProtection;
        uint16 triggerBps;
        uint256 strikePrice;
        uint256 notional;
        uint256 deductible;
        uint256 payoutCap;
        uint256 premiumPaid;
        uint256 entryPrice;
        uint256 exitPrice;
        uint256 createdAt;
        uint256 expiry;
        uint256 settledAt;
        uint256 reservedLiquidity;
        uint256 payoutAmount;
        PolicyStatus status;
    }

    address public owner;
    IInsuranceVault public immutable vault;
    IPricingEngine public immutable pricingEngine;
    bool public underwritingPaused;
    uint256 public maxUtilizationBps = 9_000;
    uint256 public emergencyPauseUtilizationBps = 9_500;
    uint256 public minimumLiquidityBuffer = 0;
    uint256 public maxDownsideExposure = type(uint256).max;
    uint256 public maxUpsideExposure = type(uint256).max;
    uint256 public maxShortTermExposure = type(uint256).max;
    uint256 public maxMediumTermExposure = type(uint256).max;
    uint256 public maxLongTermExposure = type(uint256).max;

    uint256 public nextPolicyId = 1;

    mapping(uint256 => Policy) private policies;
    mapping(address => uint256[]) public policyIdsByHolder;
    uint256[] private activePolicyIds;
    mapping(uint256 => uint256) private activePolicyIndex;
    mapping(bytes32 => uint256) public symbolExposure;
    mapping(bytes32 => uint256) public symbolExposureLimit;
    uint256 public downsideExposure;
    uint256 public upsideExposure;
    uint256 public shortTermExposure;
    uint256 public mediumTermExposure;
    uint256 public longTermExposure;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event UnderwritingPauseUpdated(bool isPaused, bytes32 indexed reason);
    event RiskLimitsUpdated(
        uint256 maxUtilizationBps,
        uint256 emergencyPauseUtilizationBps,
        uint256 minimumLiquidityBuffer,
        uint256 maxDownsideExposure,
        uint256 maxUpsideExposure,
        uint256 maxShortTermExposure,
        uint256 maxMediumTermExposure,
        uint256 maxLongTermExposure
    );
    event SymbolExposureLimitUpdated(bytes32 indexed symbol, uint256 newLimit);
    event PolicyPurchased(
        uint256 indexed policyId,
        address indexed holder,
        bytes32 indexed symbol,
        bool isDownsideProtection,
        uint16 triggerBps,
        uint256 strikePrice,
        uint256 notional,
        uint256 deductible,
        uint256 payoutCap,
        uint256 premiumPaid,
        uint256 entryPrice,
        uint256 expiry
    );
    event PolicySettled(
        uint256 indexed policyId,
        uint256 exitPrice,
        uint256 payoutAmount,
        uint256 releasedLiquidity
    );
    event PolicyCancelled(uint256 indexed policyId, address indexed holder, uint256 releasedLiquidity, uint256 cancelledAt);

    error NotOwner();
    error InvalidAddress();
    error InvalidAmount();
    error UnsupportedSymbol(bytes32 symbol);
    error PolicyNotActive();
    error PolicyNotExpired();
    error PolicyExpired();
    error CancellationLocked();
    error NotPolicyHolder();
    error UnderwritingPaused(bytes32 reason);
    error SymbolExposureLimitExceeded(bytes32 symbol);
    error DirectionExposureLimitExceeded(bool isDownsideProtection);
    error TermBucketExposureLimitExceeded(TermBucket bucket);
    error UtilizationRiskExceeded();
    error SolvencyCheckFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner, address vaultAddress, address pricingEngineAddress) {
        if (initialOwner == address(0) || vaultAddress == address(0) || pricingEngineAddress == address(0)) {
            revert InvalidAddress();
        }

        owner = initialOwner;
        vault = IInsuranceVault(vaultAddress);
        pricingEngine = IPricingEngine(pricingEngineAddress);

        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setUnderwritingPaused(bool paused, bytes32 reason) external onlyOwner {
        underwritingPaused = paused;
        emit UnderwritingPauseUpdated(paused, reason);
    }

    function configureRiskLimits(
        uint256 maxUtilizationBps_,
        uint256 emergencyPauseUtilizationBps_,
        uint256 minimumLiquidityBuffer_,
        uint256 maxDownsideExposure_,
        uint256 maxUpsideExposure_,
        uint256 maxShortTermExposure_,
        uint256 maxMediumTermExposure_,
        uint256 maxLongTermExposure_
    ) external onlyOwner {
        if (
            maxUtilizationBps_ > BPS ||
            emergencyPauseUtilizationBps_ > BPS ||
            emergencyPauseUtilizationBps_ > maxUtilizationBps_
        ) revert InvalidAmount();

        maxUtilizationBps = maxUtilizationBps_;
        emergencyPauseUtilizationBps = emergencyPauseUtilizationBps_;
        minimumLiquidityBuffer = minimumLiquidityBuffer_;
        maxDownsideExposure = maxDownsideExposure_;
        maxUpsideExposure = maxUpsideExposure_;
        maxShortTermExposure = maxShortTermExposure_;
        maxMediumTermExposure = maxMediumTermExposure_;
        maxLongTermExposure = maxLongTermExposure_;

        emit RiskLimitsUpdated(
            maxUtilizationBps_,
            emergencyPauseUtilizationBps_,
            minimumLiquidityBuffer_,
            maxDownsideExposure_,
            maxUpsideExposure_,
            maxShortTermExposure_,
            maxMediumTermExposure_,
            maxLongTermExposure_
        );
    }

    function setSymbolExposureLimit(bytes32 symbol, uint256 newLimit) external onlyOwner {
        symbolExposureLimit[symbol] = newLimit;
        emit SymbolExposureLimitUpdated(symbol, newLimit);
    }

    function purchasePolicy(
        bytes32 symbol,
        bool isDownsideProtection,
        uint256 notional,
        uint256 duration,
        uint16 triggerBps,
        uint256 deductible,
        uint256 payoutCap
    ) external returns (uint256 policyId) {
        if (notional == 0 || payoutCap == 0) revert InvalidAmount();
        if (underwritingPaused) revert UnderwritingPaused(bytes32("MANUAL_PAUSE"));
        if (!pricingEngine.isSupportedSymbol(symbol)) revert UnsupportedSymbol(symbol);

        IPricingEngine.PremiumQuote memory quote = pricingEngine.quotePremium(
            symbol,
            notional,
            duration,
            triggerBps,
            deductible,
            payoutCap,
            vault.utilizationBps(),
            isDownsideProtection
        );
        _enforceRiskChecks(symbol, isDownsideProtection, duration, quote);

        vault.reserveLiquidity(quote.payoutCap);
        vault.collectPremium(msg.sender, quote.premium);

        policyId = nextPolicyId++;
        policies[policyId] = Policy({
            id: policyId,
            holder: msg.sender,
            symbol: symbol,
            isDownsideProtection: isDownsideProtection,
            triggerBps: triggerBps,
            strikePrice: quote.strikePrice,
            notional: notional,
            deductible: deductible,
            payoutCap: payoutCap,
            premiumPaid: quote.premium,
            entryPrice: quote.spotPrice,
            exitPrice: 0,
            createdAt: block.timestamp,
            expiry: quote.expiry,
            settledAt: 0,
            reservedLiquidity: quote.payoutCap,
            payoutAmount: 0,
            status: PolicyStatus.Active
        });
        policyIdsByHolder[msg.sender].push(policyId);
        activePolicyIndex[policyId] = activePolicyIds.length;
        activePolicyIds.push(policyId);
        _increaseExposure(symbol, isDownsideProtection, duration, quote.payoutCap);

        emit PolicyPurchased(
            policyId,
            msg.sender,
            symbol,
            isDownsideProtection,
            triggerBps,
            quote.strikePrice,
            notional,
            deductible,
            payoutCap,
            quote.premium,
            quote.spotPrice,
            quote.expiry
        );
    }

    function settlePolicy(uint256 policyId) external {
        _settlePolicy(policyId);
    }

    function settlePolicies(uint256[] calldata policyIds) external {
        for (uint256 i = 0; i < policyIds.length; i++) {
            _settlePolicy(policyIds[i]);
        }
    }

    function _settlePolicy(uint256 policyId) internal {
        Policy storage policy = policies[policyId];
        if (policy.status != PolicyStatus.Active) revert PolicyNotActive();
        if (block.timestamp < policy.expiry) revert PolicyNotExpired();

        (uint256 exitPrice,) = pricingEngine.getSettlementPrice(policy.symbol, policy.expiry);
        uint256 payout = _calculatePayout(policy, exitPrice);

        policy.exitPrice = exitPrice;
        policy.payoutAmount = payout;
        policy.status = PolicyStatus.Settled;
        policy.settledAt = block.timestamp;

        if (payout > 0) {
            vault.payClaim(policy.holder, payout);
        }

        uint256 releasedLiquidity = policy.reservedLiquidity - payout;
        if (releasedLiquidity > 0) {
            vault.releaseLiquidity(releasedLiquidity);
        }
        _decreaseExposure(policy.symbol, policy.isDownsideProtection, policy.expiry - policy.createdAt, policy.reservedLiquidity);
        _removeActivePolicy(policyId);

        emit PolicySettled(policyId, exitPrice, payout, releasedLiquidity);
    }

    function cancelPolicy(uint256 policyId) external {
        Policy storage policy = policies[policyId];
        if (policy.status != PolicyStatus.Active) revert PolicyNotActive();
        if (msg.sender != policy.holder) revert NotPolicyHolder();
        if (block.timestamp >= policy.expiry) revert PolicyExpired();
        if (block.timestamp < policy.createdAt + MIN_CANCEL_DELAY) revert CancellationLocked();

        policy.status = PolicyStatus.Cancelled;
        policy.settledAt = block.timestamp;

        vault.releaseLiquidity(policy.reservedLiquidity);
        _decreaseExposure(policy.symbol, policy.isDownsideProtection, policy.expiry - policy.createdAt, policy.reservedLiquidity);
        _removeActivePolicy(policyId);
        emit PolicyCancelled(policyId, msg.sender, policy.reservedLiquidity, block.timestamp);
    }

    function getPoliciesByHolder(address holder) external view returns (uint256[] memory) {
        return policyIdsByHolder[holder];
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }

    function getActivePoliciesCount() external view returns (uint256) {
        return activePolicyIds.length;
    }

    function getActivePolicyIds(uint256 cursor, uint256 size) external view returns (uint256[] memory ids) {
        uint256 end = cursor + size;
        if (end > activePolicyIds.length) {
            end = activePolicyIds.length;
        }
        if (cursor >= end) {
            return new uint256[](0);
        }

        ids = new uint256[](end - cursor);
        for (uint256 i = cursor; i < end; i++) {
            ids[i - cursor] = activePolicyIds[i];
        }
    }

    function isPolicySettleable(uint256 policyId) public view returns (bool) {
        Policy storage policy = policies[policyId];
        if (policy.status != PolicyStatus.Active || block.timestamp < policy.expiry) {
            return false;
        }

        try pricingEngine.getSettlementPrice(policy.symbol, policy.expiry) returns (uint256, uint256) {
            return true;
        } catch {
            return false;
        }
    }

    function previewPolicy(
        bytes32 symbol,
        bool isDownsideProtection,
        uint256 notional,
        uint256 duration,
        uint16 triggerBps,
        uint256 deductible,
        uint256 payoutCap
    ) external view returns (IPricingEngine.PremiumQuote memory quote) {
        if (!pricingEngine.isSupportedSymbol(symbol)) revert UnsupportedSymbol(symbol);
        return pricingEngine.quotePremium(
            symbol,
            notional,
            duration,
            triggerBps,
            deductible,
            payoutCap,
            vault.utilizationBps(),
            isDownsideProtection
        );
    }

    function _calculatePayout(Policy storage policy, uint256 exitPrice) internal view returns (uint256 payout) {
        if (policy.entryPrice == 0) {
            return 0;
        }

        uint256 rawPayout;
        if (policy.isDownsideProtection) {
            if (exitPrice >= policy.strikePrice) {
                return 0;
            }
            rawPayout = (policy.notional * (policy.strikePrice - exitPrice)) / policy.entryPrice;
        } else {
            if (exitPrice <= policy.strikePrice) {
                return 0;
            }
            rawPayout = (policy.notional * (exitPrice - policy.strikePrice)) / policy.entryPrice;
        }

        if (rawPayout <= policy.deductible) {
            return 0;
        }

        payout = rawPayout - policy.deductible;
        if (payout > policy.payoutCap) {
            payout = policy.payoutCap;
        }
    }

    function _removeActivePolicy(uint256 policyId) internal {
        uint256 lastIndex = activePolicyIds.length - 1;
        uint256 removeIndex = activePolicyIndex[policyId];

        if (removeIndex != lastIndex) {
            uint256 movedPolicyId = activePolicyIds[lastIndex];
            activePolicyIds[removeIndex] = movedPolicyId;
            activePolicyIndex[movedPolicyId] = removeIndex;
        }

        activePolicyIds.pop();
        delete activePolicyIndex[policyId];
    }

    function _enforceRiskChecks(
        bytes32 symbol,
        bool isDownsideProtection,
        uint256 duration,
        IPricingEngine.PremiumQuote memory quote
    ) internal {
        if (quote.oracleUsedFallback) {
            underwritingPaused = true;
            emit UnderwritingPauseUpdated(true, bytes32("ORACLE_FALLBACK"));
            revert UnderwritingPaused(bytes32("ORACLE_FALLBACK"));
        }

        uint256 currentUtilization = vault.utilizationBps();
        if (currentUtilization >= emergencyPauseUtilizationBps) {
            underwritingPaused = true;
            emit UnderwritingPauseUpdated(true, bytes32("UTILIZATION"));
            revert UnderwritingPaused(bytes32("UTILIZATION"));
        }

        uint256 projectedAssets = vault.totalAssets() + quote.premium;
        uint256 projectedReserved = vault.totalReserved() + quote.payoutCap;
        uint256 projectedAvailable = projectedAssets - projectedReserved;
        if (projectedAvailable < minimumLiquidityBuffer) revert SolvencyCheckFailed();
        if (projectedAssets == 0 || (projectedReserved * BPS) / projectedAssets > maxUtilizationBps) {
            revert UtilizationRiskExceeded();
        }

        uint256 symbolLimit = symbolExposureLimit[symbol];
        if (symbolLimit != 0 && symbolExposure[symbol] + quote.payoutCap > symbolLimit) {
            revert SymbolExposureLimitExceeded(symbol);
        }

        if (isDownsideProtection) {
            if (downsideExposure + quote.payoutCap > maxDownsideExposure) {
                revert DirectionExposureLimitExceeded(true);
            }
        } else if (upsideExposure + quote.payoutCap > maxUpsideExposure) {
            revert DirectionExposureLimitExceeded(false);
        }

        TermBucket bucket = _termBucket(duration);
        if (bucket == TermBucket.Short && shortTermExposure + quote.payoutCap > maxShortTermExposure) {
            revert TermBucketExposureLimitExceeded(bucket);
        }
        if (bucket == TermBucket.Medium && mediumTermExposure + quote.payoutCap > maxMediumTermExposure) {
            revert TermBucketExposureLimitExceeded(bucket);
        }
        if (bucket == TermBucket.Long && longTermExposure + quote.payoutCap > maxLongTermExposure) {
            revert TermBucketExposureLimitExceeded(bucket);
        }

        if (quote.payoutCap > vault.availableLiquidity()) revert SolvencyCheckFailed();
    }

    function _increaseExposure(bytes32 symbol, bool isDownsideProtection, uint256 duration, uint256 amount) internal {
        symbolExposure[symbol] += amount;

        if (isDownsideProtection) {
            downsideExposure += amount;
        } else {
            upsideExposure += amount;
        }

        TermBucket bucket = _termBucket(duration);
        if (bucket == TermBucket.Short) {
            shortTermExposure += amount;
        } else if (bucket == TermBucket.Medium) {
            mediumTermExposure += amount;
        } else {
            longTermExposure += amount;
        }
    }

    function _decreaseExposure(bytes32 symbol, bool isDownsideProtection, uint256 duration, uint256 amount) internal {
        symbolExposure[symbol] -= amount;

        if (isDownsideProtection) {
            downsideExposure -= amount;
        } else {
            upsideExposure -= amount;
        }

        TermBucket bucket = _termBucket(duration);
        if (bucket == TermBucket.Short) {
            shortTermExposure -= amount;
        } else if (bucket == TermBucket.Medium) {
            mediumTermExposure -= amount;
        } else {
            longTermExposure -= amount;
        }
    }

    function _termBucket(uint256 duration) internal pure returns (TermBucket bucket) {
        if (duration <= SHORT_TERM_MAX) {
            return TermBucket.Short;
        }
        if (duration <= MEDIUM_TERM_MAX) {
            return TermBucket.Medium;
        }
        bucket = TermBucket.Long;
    }
}
