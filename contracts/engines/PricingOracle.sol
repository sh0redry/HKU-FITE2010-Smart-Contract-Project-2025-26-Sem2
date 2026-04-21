// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IPricingEngine.sol";
import "../interfaces/IRiskParameterProvider.sol";

contract PricingOracle is IPricingEngine {
    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    uint256 private constant DAY = 1 days;
    uint256 private constant SHORT_TERM_MAX = 7 days;
    uint256 private constant MEDIUM_TERM_MAX = 21 days;

    address public owner;
    address public override riskParameterProvider;

    struct MarketConfig {
        address spotFeed;
        uint256 minDuration;
        uint256 maxDuration;
        uint256 basePremiumBps;
        uint256 maxNotional;
        uint16 minTriggerBps;
        uint16 maxTriggerBps;
        uint16 openMinutesUtc;
        uint16 closeMinutesUtc;
        bool enforceMarketHours;
        bool isActive;
    }

    struct MarketConfigInput {
        address spotFeed;
        uint256 minDuration;
        uint256 maxDuration;
        uint256 basePremiumBps;
        uint256 maxNotional;
        uint16 minTriggerBps;
        uint16 maxTriggerBps;
        uint16 openMinutesUtc;
        uint16 closeMinutesUtc;
        bool enforceMarketHours;
        bool isActive;
    }

    mapping(bytes32 => MarketConfig) private marketConfigs;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MarketConfigured(
        bytes32 indexed symbol,
        address indexed spotFeed,
        uint256 basePremiumBps,
        uint256 maxNotional
    );
    event RiskParameterProviderUpdated(address indexed previousProvider, address indexed newProvider);

    error NotOwner();
    error InvalidAddress();
    error MarketInactive(bytes32 symbol);
    error InvalidDuration();
    error NotionalTooLarge();
    error InvalidUtilization();
    error InvalidTrigger();
    error InvalidPayoutTerms();
    error MarketClosed(bytes32 symbol);
    error InvalidOracleAnswer();
    error InvalidRiskProvider();
    error MissingRiskSnapshot(bytes32 symbol);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner, address riskParameterProviderAddress) {
        if (initialOwner == address(0) || riskParameterProviderAddress == address(0)) revert InvalidAddress();
        owner = initialOwner;
        riskParameterProvider = riskParameterProviderAddress;
        emit OwnershipTransferred(address(0), initialOwner);
        emit RiskParameterProviderUpdated(address(0), riskParameterProviderAddress);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setRiskParameterProvider(address newProvider) external onlyOwner {
        if (newProvider == address(0)) revert InvalidRiskProvider();
        emit RiskParameterProviderUpdated(riskParameterProvider, newProvider);
        riskParameterProvider = newProvider;
    }

    function configureMarket(bytes32 symbol, MarketConfigInput calldata config) external onlyOwner {
        if (config.spotFeed == address(0)) revert InvalidAddress();
        if (config.minDuration == 0 || config.maxDuration < config.minDuration) revert InvalidDuration();
        if (config.openMinutesUtc >= DAY / 1 minutes || config.closeMinutesUtc >= DAY / 1 minutes) {
            revert InvalidDuration();
        }
        if (config.minTriggerBps < 500 || config.maxTriggerBps > 2_000 || config.maxTriggerBps < config.minTriggerBps) {
            revert InvalidTrigger();
        }

        MarketConfig storage market = marketConfigs[symbol];
        market.spotFeed = config.spotFeed;
        market.minDuration = config.minDuration;
        market.maxDuration = config.maxDuration;
        market.basePremiumBps = config.basePremiumBps;
        market.maxNotional = config.maxNotional;
        market.minTriggerBps = config.minTriggerBps;
        market.maxTriggerBps = config.maxTriggerBps;
        market.openMinutesUtc = config.openMinutesUtc;
        market.closeMinutesUtc = config.closeMinutesUtc;
        market.enforceMarketHours = config.enforceMarketHours;
        market.isActive = config.isActive;

        emit MarketConfigured(
            symbol,
            config.spotFeed,
            config.basePremiumBps,
            config.maxNotional
        );
    }

    function quotePremium(
        bytes32 symbol,
        uint256 notional,
        uint256 duration,
        uint16 triggerBps,
        uint256 deductible,
        uint256 payoutCap,
        uint256 utilizationBpsValue,
        bool isDownsideProtection
    ) external view returns (PremiumQuote memory quote) {
        MarketConfig storage config = marketConfigs[symbol];
        if (!config.isActive) revert MarketInactive(symbol);
        if (duration < config.minDuration || duration > config.maxDuration) revert InvalidDuration();
        if (notional == 0 || notional > config.maxNotional) revert NotionalTooLarge();
        if (utilizationBpsValue > BPS) revert InvalidUtilization();
        if (triggerBps < config.minTriggerBps || triggerBps > config.maxTriggerBps) revert InvalidTrigger();
        if (payoutCap == 0 || payoutCap > notional || deductible >= payoutCap) revert InvalidPayoutTerms();
        if (!_isMarketOpen(config)) revert MarketClosed(symbol);

        uint256 spotPrice = _readNormalizedFeed(config.spotFeed);
        IRiskParameterProvider.RiskSnapshot memory snapshot = IRiskParameterProvider(riskParameterProvider)
            .getRiskSnapshot(symbol);
        if (snapshot.impliedVolBps == 0 || snapshot.updatedAt == 0) revert MissingRiskSnapshot(symbol);

        uint256 annualVolBps = snapshot.impliedVolBps;
        uint256 directionalRiskBps = isDownsideProtection ? snapshot.downsideSkewBps : snapshot.upsideSkewBps;
        uint256 inventoryPressureBps =
            isDownsideProtection ? snapshot.downsideInventoryPressureBps : snapshot.upsideInventoryPressureBps;
        uint256 termStructureMultiplierBps = _termMultiplier(duration, snapshot);
        uint256 surchargeBps = _utilizationSurcharge(utilizationBpsValue);
        uint256 strikePrice = isDownsideProtection
            ? (spotPrice * (BPS - triggerBps)) / BPS
            : (spotPrice * (BPS + triggerBps)) / BPS;
        uint256 estimatedProbabilityBps =
            _estimateProbabilityBps(annualVolBps, duration, triggerBps, directionalRiskBps, snapshot.riskScoreBps);
        uint256 moveMagnitudeBps = triggerBps + (((annualVolBps * termStructureMultiplierBps) / BPS) * duration) / YEAR;
        uint256 stressPremiumBps = snapshot.stressPremiumBps + (snapshot.riskScoreBps / 20);
        uint256 totalRateBps =
            config.basePremiumBps +
            directionalRiskBps +
            inventoryPressureBps +
            stressPremiumBps +
            surchargeBps +
            (estimatedProbabilityBps / 12) +
            (moveMagnitudeBps / 8) +
            ((payoutCap * 1_000) / notional);
        uint256 premium = (notional * totalRateBps) / BPS;

        quote = PremiumQuote({
            premium: premium,
            spotPrice: spotPrice,
            strikePrice: strikePrice,
            notional: notional,
            deductible: deductible,
            payoutCap: payoutCap,
            annualVolBps: annualVolBps,
            estimatedProbabilityBps: estimatedProbabilityBps,
            termStructureMultiplierBps: termStructureMultiplierBps,
            directionalRiskBps: directionalRiskBps,
            inventoryPressureBps: inventoryPressureBps,
            stressPremiumBps: stressPremiumBps,
            riskScoreBps: snapshot.riskScoreBps,
            utilizationSurchargeBps: surchargeBps,
            triggerBps: triggerBps,
            isDownsideProtection: isDownsideProtection,
            expiry: block.timestamp + duration
        });
    }

    function getSpotPrice(bytes32 symbol) external view returns (uint256) {
        MarketConfig storage config = marketConfigs[symbol];
        if (!config.isActive) revert MarketInactive(symbol);
        return _readNormalizedFeed(config.spotFeed);
    }

    function isMarketOpen(bytes32 symbol) external view returns (bool) {
        MarketConfig storage config = marketConfigs[symbol];
        if (!config.isActive) {
            return false;
        }
        return _isMarketOpen(config);
    }

    function isSupportedSymbol(bytes32 symbol) external view returns (bool) {
        return marketConfigs[symbol].isActive;
    }

    function _utilizationSurcharge(uint256 utilizationBpsValue) internal pure returns (uint256) {
        if (utilizationBpsValue <= 7_000) {
            return utilizationBpsValue / 20;
        }

        uint256 excess = utilizationBpsValue - 7_000;
        return 350 + (excess * excess) / 900;
    }

    function _estimateProbabilityBps(
        uint256 annualVolBps,
        uint256 duration,
        uint16 triggerBps,
        uint256 directionalRiskBps,
        uint256 riskScoreBps
    ) internal pure returns (uint256 probabilityBps) {
        uint256 timeScaledVolBps = (annualVolBps * duration) / YEAR;
        uint256 difficulty = uint256(triggerBps) + 250;
        uint256 raw = ((timeScaledVolBps + directionalRiskBps + (riskScoreBps / 10) + 300) * BPS) / difficulty;

        if (raw < 300) {
            return 300;
        }
        if (raw > 9_000) {
            return 9_000;
        }
        probabilityBps = raw;
    }

    function _termMultiplier(uint256 duration, IRiskParameterProvider.RiskSnapshot memory snapshot)
        internal
        pure
        returns (uint256 multiplierBps)
    {
        if (duration <= SHORT_TERM_MAX) {
            return snapshot.shortTermMultiplierBps;
        }
        if (duration <= MEDIUM_TERM_MAX) {
            return snapshot.mediumTermMultiplierBps;
        }
        multiplierBps = snapshot.longTermMultiplierBps;
    }

    function _readNormalizedFeed(address feed) internal view returns (uint256 value) {
        int256 answer = IPriceFeed(feed).latestAnswer();
        if (answer <= 0) revert InvalidOracleAnswer();

        uint8 feedDecimals = IPriceFeed(feed).decimals();
        value = uint256(answer);

        if (feedDecimals < 18) {
            value *= 10 ** (18 - feedDecimals);
        } else if (feedDecimals > 18) {
            value /= 10 ** (feedDecimals - 18);
        }
    }

    function _isMarketOpen(MarketConfig storage config) internal view returns (bool) {
        if (!config.enforceMarketHours) {
            return true;
        }

        uint256 dayOfWeek = ((block.timestamp / DAY) + 4) % 7;
        if (dayOfWeek == 0 || dayOfWeek == 6) {
            return false;
        }

        uint256 minutesUtc = (block.timestamp % DAY) / 1 minutes;
        return minutesUtc >= config.openMinutesUtc && minutesUtc < config.closeMinutesUtc;
    }
}
