// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPricingEngine {
    struct PremiumQuote {
        uint256 premium;
        uint256 spotPrice;
        uint256 strikePrice;
        uint256 notional;
        uint256 deductible;
        uint256 payoutCap;
        uint256 annualVolBps;
        uint256 estimatedProbabilityBps;
        uint256 termStructureMultiplierBps;
        uint256 directionalRiskBps;
        uint256 inventoryPressureBps;
        uint256 stressPremiumBps;
        uint256 riskScoreBps;
        uint256 utilizationSurchargeBps;
        uint16 triggerBps;
        bool isDownsideProtection;
        uint256 expiry;
    }

    struct MarketHours {
        uint16 openMinutesUtc;
        uint16 closeMinutesUtc;
        bool enforceWindow;
    }

    function quotePremium(
        bytes32 symbol,
        uint256 notional,
        uint256 duration,
        uint16 triggerBps,
        uint256 deductible,
        uint256 payoutCap,
        uint256 utilizationBps,
        bool isDownsideProtection
    ) external view returns (PremiumQuote memory quote);

    function getSpotPrice(bytes32 symbol) external view returns (uint256);

    function isMarketOpen(bytes32 symbol) external view returns (bool);

    function isSupportedSymbol(bytes32 symbol) external view returns (bool);

    function riskParameterProvider() external view returns (address);
}
