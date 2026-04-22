// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IInsuranceVault.sol";
import "../interfaces/IPricingEngine.sol";

contract PolicyFactory {
    uint256 public constant BPS = 10_000;
    uint256 public constant MIN_CANCEL_DELAY = 30 minutes;

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

    uint256 public nextPolicyId = 1;

    mapping(uint256 => Policy) private policies;
    mapping(address => uint256[]) public policyIdsByHolder;
    uint256[] private activePolicyIds;
    mapping(uint256 => uint256) private activePolicyIndex;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
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
}
