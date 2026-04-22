// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPricingEngine {
    enum SettlementMode {
        CurrentPrice,
        NextMarketOpen
    }

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
        uint256 overnightGapSurchargeBps;
        uint256 oracleUpdatedAt;
        uint16 triggerBps;
        bool isDownsideProtection;
        bool oracleUsedFallback;
        bool settlesAtNextOpen;
        uint256 expiry;
        uint256 effectiveSettlementTime;
        bytes32 oracleSourceTag;
    }

    struct MarketHours {
        uint16 openMinutes;
        uint16 closeMinutes;
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

    function getSettlementPrice(bytes32 symbol, uint256 scheduledExpiry)
        external
        view
        returns (uint256 price, uint256 effectiveTimestamp);

    function isMarketOpen(bytes32 symbol) external view returns (bool);

    function isSupportedSymbol(bytes32 symbol) external view returns (bool);

    function riskParameterProvider() external view returns (address);

    function oracleAdapter() external view returns (address);
}
