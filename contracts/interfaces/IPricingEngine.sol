// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPricingEngine {
    struct PremiumQuote {
        uint256 premium;
        uint256 spotPrice;
        uint256 annualVolBps;
        uint256 utilizationSurchargeBps;
        uint256 expiry;
    }

    struct MarketHours {
        uint16 openMinutesUtc;
        uint16 closeMinutesUtc;
        bool enforceWindow;
    }

    function quotePremium(
        bytes32 symbol,
        uint256 coverageAmount,
        uint256 duration,
        uint256 utilizationBps,
        bool isDownsideProtection
    ) external view returns (PremiumQuote memory quote);

    function getSpotPrice(bytes32 symbol) external view returns (uint256);

    function isMarketOpen(bytes32 symbol) external view returns (bool);

    function isSupportedSymbol(bytes32 symbol) external view returns (bool);
}
