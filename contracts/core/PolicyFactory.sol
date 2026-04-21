// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IInsuranceVault.sol";
import "../interfaces/IPricingEngine.sol";

contract PolicyFactory {
    uint256 public constant BPS = 10_000;

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
        uint256 coverageAmount;
        uint256 premiumPaid;
        uint256 entryPrice;
        uint256 exitPrice;
        uint256 startedAt;
        uint256 expiry;
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

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PolicyPurchased(
        uint256 indexed policyId,
        address indexed holder,
        bytes32 indexed symbol,
        bool isDownsideProtection,
        uint256 coverageAmount,
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

    error NotOwner();
    error InvalidAddress();
    error InvalidAmount();
    error UnsupportedSymbol(bytes32 symbol);
    error PolicyNotActive();
    error PolicyNotExpired();
    error PremiumTooLow(uint256 expected, uint256 actual);
    error RefundFailed();

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
        uint256 coverageAmount,
        uint256 duration
    ) external payable returns (uint256 policyId) {
        if (coverageAmount == 0) revert InvalidAmount();
        if (!pricingEngine.isSupportedSymbol(symbol)) revert UnsupportedSymbol(symbol);

        IPricingEngine.PremiumQuote memory quote = pricingEngine.quotePremium(
            symbol,
            coverageAmount,
            duration,
            vault.utilizationBps(),
            isDownsideProtection
        );

        if (msg.value < quote.premium) {
            revert PremiumTooLow(quote.premium, msg.value);
        }

        vault.reserveLiquidity(coverageAmount);
        vault.collectPremium{value: quote.premium}();

        policyId = nextPolicyId++;
        policies[policyId] = Policy({
            id: policyId,
            holder: msg.sender,
            symbol: symbol,
            isDownsideProtection: isDownsideProtection,
            coverageAmount: coverageAmount,
            premiumPaid: quote.premium,
            entryPrice: quote.spotPrice,
            exitPrice: 0,
            startedAt: block.timestamp,
            expiry: quote.expiry,
            reservedLiquidity: coverageAmount,
            payoutAmount: 0,
            status: PolicyStatus.Active
        });
        policyIdsByHolder[msg.sender].push(policyId);

        emit PolicyPurchased(
            policyId,
            msg.sender,
            symbol,
            isDownsideProtection,
            coverageAmount,
            quote.premium,
            quote.spotPrice,
            quote.expiry
        );

        uint256 refund = msg.value - quote.premium;
        if (refund > 0) {
            (bool success, ) = payable(msg.sender).call{value: refund}("");
            if (!success) revert RefundFailed();
        }
    }

    function settlePolicy(uint256 policyId) external {
        Policy storage policy = policies[policyId];
        if (policy.status != PolicyStatus.Active) revert PolicyNotActive();
        if (block.timestamp < policy.expiry) revert PolicyNotExpired();

        uint256 exitPrice = pricingEngine.getSpotPrice(policy.symbol);
        uint256 payout = _calculatePayout(policy.entryPrice, exitPrice, policy.coverageAmount, policy.isDownsideProtection);

        policy.exitPrice = exitPrice;
        policy.payoutAmount = payout;
        policy.status = PolicyStatus.Settled;

        if (payout > 0) {
            vault.payClaim(payable(policy.holder), payout);
        }

        uint256 releasedLiquidity = policy.reservedLiquidity - payout;
        if (releasedLiquidity > 0) {
            vault.releaseLiquidity(releasedLiquidity);
        }

        emit PolicySettled(policyId, exitPrice, payout, releasedLiquidity);
    }

    function getPoliciesByHolder(address holder) external view returns (uint256[] memory) {
        return policyIdsByHolder[holder];
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }

    function previewPolicy(
        bytes32 symbol,
        bool isDownsideProtection,
        uint256 coverageAmount,
        uint256 duration
    ) external view returns (IPricingEngine.PremiumQuote memory quote) {
        if (!pricingEngine.isSupportedSymbol(symbol)) revert UnsupportedSymbol(symbol);
        return pricingEngine.quotePremium(
            symbol,
            coverageAmount,
            duration,
            vault.utilizationBps(),
            isDownsideProtection
        );
    }

    function _calculatePayout(
        uint256 entryPrice,
        uint256 exitPrice,
        uint256 coverageAmount,
        bool isDownsideProtection
    ) internal pure returns (uint256 payout) {
        if (entryPrice == 0) {
            return 0;
        }

        if (isDownsideProtection) {
            if (exitPrice >= entryPrice) {
                return 0;
            }
            payout = (coverageAmount * (entryPrice - exitPrice)) / entryPrice;
        } else {
            if (exitPrice <= entryPrice) {
                return 0;
            }
            payout = (coverageAmount * (exitPrice - entryPrice)) / entryPrice;
        }

        if (payout > coverageAmount) {
            payout = coverageAmount;
        }
    }
}
