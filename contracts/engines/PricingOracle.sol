// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPriceFeed.sol";
import "../interfaces/IPricingEngine.sol";

contract PricingOracle is IPricingEngine {
    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    uint256 private constant DAY = 1 days;

    address public owner;

    struct MarketConfig {
        address spotFeed;
        address volFeed;
        uint256 minDuration;
        uint256 maxDuration;
        uint256 basePremiumBps;
        uint256 maxCoverage;
        uint256 downsideRiskBps;
        uint256 upsideRiskBps;
        uint16 openMinutesUtc;
        uint16 closeMinutesUtc;
        bool enforceMarketHours;
        bool isActive;
    }

    mapping(bytes32 => MarketConfig) public marketConfigs;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MarketConfigured(
        bytes32 indexed symbol,
        address indexed spotFeed,
        address indexed volFeed,
        uint256 basePremiumBps,
        uint256 maxCoverage
    );

    error NotOwner();
    error InvalidAddress();
    error MarketInactive(bytes32 symbol);
    error InvalidDuration();
    error CoverageTooLarge();
    error InvalidUtilization();
    error MarketClosed(bytes32 symbol);
    error InvalidOracleAnswer();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function configureMarket(
        bytes32 symbol,
        address spotFeed,
        address volFeed,
        uint256 minDuration,
        uint256 maxDuration,
        uint256 basePremiumBps,
        uint256 maxCoverage,
        uint256 downsideRiskBps,
        uint256 upsideRiskBps,
        uint16 openMinutesUtc,
        uint16 closeMinutesUtc,
        bool enforceMarketHours,
        bool isActive
    ) external onlyOwner {
        if (spotFeed == address(0) || volFeed == address(0)) revert InvalidAddress();
        if (minDuration == 0 || maxDuration < minDuration) revert InvalidDuration();
        if (openMinutesUtc >= DAY / 1 minutes || closeMinutesUtc >= DAY / 1 minutes) revert InvalidDuration();

        marketConfigs[symbol] = MarketConfig({
            spotFeed: spotFeed,
            volFeed: volFeed,
            minDuration: minDuration,
            maxDuration: maxDuration,
            basePremiumBps: basePremiumBps,
            maxCoverage: maxCoverage,
            downsideRiskBps: downsideRiskBps,
            upsideRiskBps: upsideRiskBps,
            openMinutesUtc: openMinutesUtc,
            closeMinutesUtc: closeMinutesUtc,
            enforceMarketHours: enforceMarketHours,
            isActive: isActive
        });

        emit MarketConfigured(symbol, spotFeed, volFeed, basePremiumBps, maxCoverage);
    }

    function quotePremium(
        bytes32 symbol,
        uint256 coverageAmount,
        uint256 duration,
        uint256 utilizationBpsValue,
        bool isDownsideProtection
    ) external view returns (PremiumQuote memory quote) {
        MarketConfig memory config = marketConfigs[symbol];
        if (!config.isActive) revert MarketInactive(symbol);
        if (duration < config.minDuration || duration > config.maxDuration) revert InvalidDuration();
        if (coverageAmount == 0 || coverageAmount > config.maxCoverage) revert CoverageTooLarge();
        if (utilizationBpsValue > BPS) revert InvalidUtilization();
        if (!_isMarketOpen(config)) revert MarketClosed(symbol);

        uint256 spotPrice = _readNormalizedFeed(config.spotFeed);
        uint256 annualVolBps = _readNormalizedFeed(config.volFeed);
        uint256 riskBps = isDownsideProtection ? config.downsideRiskBps : config.upsideRiskBps;
        uint256 surchargeBps = _utilizationSurcharge(utilizationBpsValue);

        uint256 timeScaledRiskBps = (annualVolBps * duration) / YEAR;
        uint256 totalRateBps = config.basePremiumBps + timeScaledRiskBps + riskBps + surchargeBps;
        uint256 premium = (coverageAmount * totalRateBps) / BPS;

        quote = PremiumQuote({
            premium: premium,
            spotPrice: spotPrice,
            annualVolBps: annualVolBps,
            utilizationSurchargeBps: surchargeBps,
            expiry: block.timestamp + duration
        });
    }

    function getSpotPrice(bytes32 symbol) external view returns (uint256) {
        MarketConfig memory config = marketConfigs[symbol];
        if (!config.isActive) revert MarketInactive(symbol);
        return _readNormalizedFeed(config.spotFeed);
    }

    function isMarketOpen(bytes32 symbol) external view returns (bool) {
        MarketConfig memory config = marketConfigs[symbol];
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

    function _isMarketOpen(MarketConfig memory config) internal view returns (bool) {
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
