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
    uint256 private constant EASTERN_STANDARD_OFFSET = 5 hours;
    uint256 private constant EASTERN_DAYLIGHT_OFFSET = 4 hours;

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
        uint16 openMinutesLocal;
        uint16 closeMinutesLocal;
        uint16 closeBufferMinutes;
        uint16 overnightGapSurchargeBps;
        bool enforceMarketHours;
        bool useUsEquityCalendar;
        SettlementMode settlementMode;
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
        uint16 openMinutesLocal;
        uint16 closeMinutesLocal;
        uint16 closeBufferMinutes;
        uint16 overnightGapSurchargeBps;
        bool enforceMarketHours;
        bool useUsEquityCalendar;
        SettlementMode settlementMode;
        bool isActive;
    }

    struct SessionContext {
        bool isOpen;
        bool isHoliday;
        uint256 minutesLocal;
        uint256 openTimestamp;
        uint256 closeTimestamp;
        uint256 nextOpenTimestamp;
        uint256 localDateKey;
    }

    mapping(bytes32 => MarketConfig) private marketConfigs;
    mapping(uint256 => bool) public holidayClosures;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MarketConfigured(
        bytes32 indexed symbol,
        address indexed spotFeed,
        uint256 basePremiumBps,
        uint256 maxNotional
    );
    event RiskParameterProviderUpdated(address indexed previousProvider, address indexed newProvider);
    event HolidayClosureUpdated(uint256 indexed dateKey, bool isClosed);

    error NotOwner();
    error InvalidAddress();
    error MarketInactive(bytes32 symbol);
    error InvalidDuration();
    error NotionalTooLarge();
    error InvalidUtilization();
    error InvalidTrigger();
    error InvalidPayoutTerms();
    error MarketClosed(bytes32 symbol);
    error MarketClosingSoon(bytes32 symbol);
    error InvalidOracleAnswer();
    error InvalidRiskProvider();
    error MissingRiskSnapshot(bytes32 symbol);
    error SettlementPricePending(bytes32 symbol, uint256 effectiveTimestamp);

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
        if (config.openMinutesLocal >= DAY / 1 minutes || config.closeMinutesLocal >= DAY / 1 minutes) {
            revert InvalidDuration();
        }
        if (config.closeMinutesLocal <= config.openMinutesLocal) revert InvalidDuration();
        if (config.closeBufferMinutes >= config.closeMinutesLocal - config.openMinutesLocal) revert InvalidDuration();
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
        market.openMinutesLocal = config.openMinutesLocal;
        market.closeMinutesLocal = config.closeMinutesLocal;
        market.closeBufferMinutes = config.closeBufferMinutes;
        market.overnightGapSurchargeBps = config.overnightGapSurchargeBps;
        market.enforceMarketHours = config.enforceMarketHours;
        market.useUsEquityCalendar = config.useUsEquityCalendar;
        market.settlementMode = config.settlementMode;
        market.isActive = config.isActive;

        emit MarketConfigured(
            symbol,
            config.spotFeed,
            config.basePremiumBps,
            config.maxNotional
        );
    }

    function setHolidayClosure(uint256 dateKey, bool isClosed) external onlyOwner {
        holidayClosures[dateKey] = isClosed;
        emit HolidayClosureUpdated(dateKey, isClosed);
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
        SessionContext memory currentSession = _sessionContext(config, block.timestamp);
        if (config.enforceMarketHours && !currentSession.isOpen) revert MarketClosed(symbol);
        if (config.enforceMarketHours && config.closeBufferMinutes > 0) {
            if (currentSession.closeTimestamp <= block.timestamp) revert MarketClosingSoon(symbol);
            uint256 minutesUntilClose = (currentSession.closeTimestamp - block.timestamp) / 1 minutes;
            if (minutesUntilClose <= config.closeBufferMinutes) revert MarketClosingSoon(symbol);
        }

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
        uint256 scheduledExpiry = block.timestamp + duration;
        uint256 effectiveSettlementTime = _effectiveSettlementTimestamp(config, scheduledExpiry);
        uint256 overnightGapSurchargeBps = _crossesMarketClosure(config, currentSession, scheduledExpiry)
            ? config.overnightGapSurchargeBps
            : 0;
        uint256 totalRateBps =
            config.basePremiumBps +
            directionalRiskBps +
            inventoryPressureBps +
            stressPremiumBps +
            surchargeBps +
            overnightGapSurchargeBps +
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
            overnightGapSurchargeBps: overnightGapSurchargeBps,
            triggerBps: triggerBps,
            isDownsideProtection: isDownsideProtection,
            settlesAtNextOpen: effectiveSettlementTime > scheduledExpiry,
            expiry: scheduledExpiry,
            effectiveSettlementTime: effectiveSettlementTime
        });
    }

    function getSpotPrice(bytes32 symbol) external view returns (uint256) {
        MarketConfig storage config = marketConfigs[symbol];
        if (!config.isActive) revert MarketInactive(symbol);
        return _readNormalizedFeed(config.spotFeed);
    }

    function getSettlementPrice(bytes32 symbol, uint256 scheduledExpiry)
        external
        view
        returns (uint256 price, uint256 effectiveTimestamp)
    {
        MarketConfig storage config = marketConfigs[symbol];
        if (!config.isActive) revert MarketInactive(symbol);

        effectiveTimestamp = _effectiveSettlementTimestamp(config, scheduledExpiry);
        if (block.timestamp < effectiveTimestamp) revert SettlementPricePending(symbol, effectiveTimestamp);

        price = _readNormalizedFeed(config.spotFeed);
    }

    function getSessionWindow(bytes32 symbol, uint256 timestamp)
        external
        view
        returns (
            bool isOpen,
            bool isHoliday,
            uint256 localDateKey,
            uint256 minutesLocal,
            uint256 openTimestamp,
            uint256 closeTimestamp,
            uint256 nextOpenTimestamp
        )
    {
        MarketConfig storage config = marketConfigs[symbol];
        if (!config.isActive) revert MarketInactive(symbol);

        SessionContext memory session = _sessionContext(config, timestamp);
        return (
            session.isOpen,
            session.isHoliday,
            session.localDateKey,
            session.minutesLocal,
            session.openTimestamp,
            session.closeTimestamp,
            session.nextOpenTimestamp
        );
    }

    function isMarketOpen(bytes32 symbol) external view returns (bool) {
        MarketConfig storage config = marketConfigs[symbol];
        if (!config.isActive) {
            return false;
        }
        return _sessionContext(config, block.timestamp).isOpen;
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

    function _effectiveSettlementTimestamp(MarketConfig storage config, uint256 scheduledExpiry)
        internal
        view
        returns (uint256 effectiveTimestamp)
    {
        if (config.settlementMode == SettlementMode.CurrentPrice || !config.useUsEquityCalendar) {
            return scheduledExpiry;
        }

        SessionContext memory expirySession = _sessionContext(config, scheduledExpiry);
        if (expirySession.isOpen) {
            return scheduledExpiry;
        }

        effectiveTimestamp = expirySession.nextOpenTimestamp;
    }

    function _crossesMarketClosure(
        MarketConfig storage config,
        SessionContext memory currentSession,
        uint256 scheduledExpiry
    ) internal view returns (bool) {
        if (!config.useUsEquityCalendar) {
            return false;
        }

        return scheduledExpiry > currentSession.closeTimestamp;
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

    function _sessionContext(MarketConfig storage config, uint256 timestamp)
        internal
        view
        returns (SessionContext memory context)
    {
        if (!config.useUsEquityCalendar) {
            uint256 dayOfWeekUtc = ((timestamp / DAY) + 4) % 7;
            if (dayOfWeekUtc == 0 || dayOfWeekUtc == 6) {
                return SessionContext({
                    isOpen: false,
                    isHoliday: false,
                    minutesLocal: 0,
                    openTimestamp: 0,
                    closeTimestamp: 0,
                    nextOpenTimestamp: 0,
                    localDateKey: 0
                });
            }

            uint256 minutesUtc = (timestamp % DAY) / 1 minutes;
            bool open = minutesUtc >= config.openMinutesLocal && minutesUtc < config.closeMinutesLocal;

            return SessionContext({
                isOpen: open,
                isHoliday: false,
                minutesLocal: minutesUtc,
                openTimestamp: (timestamp / DAY) * DAY + (uint256(config.openMinutesLocal) * 1 minutes),
                closeTimestamp: (timestamp / DAY) * DAY + (uint256(config.closeMinutesLocal) * 1 minutes),
                nextOpenTimestamp: (timestamp / DAY) * DAY + DAY + (uint256(config.openMinutesLocal) * 1 minutes),
                localDateKey: 0
            });
        }

        (uint256 year, uint256 month, uint256 day, uint256 minutesLocal, uint256 offsetSeconds) = _localDateTime(timestamp);
        uint256 dateKey = (year * 10_000) + (month * 100) + day;
        uint256 weekday = _getDayOfWeek(year, month, day);
        bool isHoliday = holidayClosures[dateKey];
        bool isWeekend = weekday == 0 || weekday == 6;
        bool isOpen = !isHoliday &&
            !isWeekend &&
            minutesLocal >= config.openMinutesLocal &&
            minutesLocal < config.closeMinutesLocal;

        uint256 dayStartUtc = _dayStartUtc(timestamp, offsetSeconds);

        context = SessionContext({
            isOpen: isOpen,
            isHoliday: isHoliday,
            minutesLocal: minutesLocal,
            openTimestamp: dayStartUtc + (uint256(config.openMinutesLocal) * 1 minutes),
            closeTimestamp: dayStartUtc + (uint256(config.closeMinutesLocal) * 1 minutes),
            nextOpenTimestamp: _nextSessionOpen(config, timestamp + 1),
            localDateKey: dateKey
        });
    }

    function _nextSessionOpen(MarketConfig storage config, uint256 timestamp) internal view returns (uint256 openTimestamp) {
        uint256 cursor = timestamp;

        for (uint256 i = 0; i < 10; i++) {
            (uint256 year, uint256 month, uint256 day,, uint256 offsetSeconds) = _localDateTime(cursor);
            uint256 dateKey = (year * 10_000) + (month * 100) + day;
            uint256 weekday = _getDayOfWeek(year, month, day);

            if (weekday != 0 && weekday != 6 && !holidayClosures[dateKey]) {
                uint256 dayStartUtc = _dayStartUtc(cursor, offsetSeconds);
                openTimestamp = dayStartUtc + (uint256(config.openMinutesLocal) * 1 minutes);
                if (openTimestamp >= timestamp) {
                    return openTimestamp;
                }
            }

            cursor = _dayStartUtc(cursor, offsetSeconds) + DAY + 1;
        }
    }

    function _dayStartUtc(uint256 timestamp, uint256 offsetSeconds) internal pure returns (uint256) {
        return (((timestamp - offsetSeconds) / DAY) * DAY) + offsetSeconds;
    }

    function _localDateTime(uint256 timestamp)
        internal
        pure
        returns (uint256 year, uint256 month, uint256 day, uint256 minutesLocal, uint256 offsetSeconds)
    {
        offsetSeconds = _isUsDaylightSaving(timestamp) ? EASTERN_DAYLIGHT_OFFSET : EASTERN_STANDARD_OFFSET;
        uint256 localTimestamp = timestamp - offsetSeconds;
        (year, month, day) = _daysToDate(localTimestamp / DAY);
        minutesLocal = (localTimestamp % DAY) / 1 minutes;
    }

    function _isUsDaylightSaving(uint256 timestamp) internal pure returns (bool) {
        (uint256 year,,) = _daysToDate(timestamp / DAY);
        uint256 dstStart = _dstStartUtc(year);
        uint256 dstEnd = _dstEndUtc(year);
        return timestamp >= dstStart && timestamp < dstEnd;
    }

    function _dstStartUtc(uint256 year) internal pure returns (uint256) {
        uint256 secondSunday = _nthSunday(year, 3, 2);
        return (_daysFromDate(year, 3, secondSunday) * DAY) + 7 hours;
    }

    function _dstEndUtc(uint256 year) internal pure returns (uint256) {
        uint256 firstSunday = _nthSunday(year, 11, 1);
        return (_daysFromDate(year, 11, firstSunday) * DAY) + 6 hours;
    }

    function _nthSunday(uint256 year, uint256 month, uint256 occurrence) internal pure returns (uint256 day) {
        uint256 weekday = _getDayOfWeek(year, month, 1);
        uint256 firstSunday = weekday == 0 ? 1 : 8 - weekday;
        day = firstSunday + ((occurrence - 1) * 7);
    }

    function _getDayOfWeek(uint256 year, uint256 month, uint256 day) internal pure returns (uint256) {
        return (_daysFromDate(year, month, day) + 4) % 7;
    }

    function _daysFromDate(uint256 year, uint256 month, uint256 day) internal pure returns (uint256 _days) {
        int256 __days = int256(day)
            - 32075
            + (1461 * (int256(year) + 4800 + (int256(month) - 14) / 12)) / 4
            + (367 * (int256(month) - 2 - (((int256(month) - 14) / 12) * 12))) / 12
            - (3 * ((int256(year) + 4900 + (int256(month) - 14) / 12) / 100)) / 4
            - 2440588;

        _days = uint256(__days);
    }

    function _daysToDate(uint256 _days) internal pure returns (uint256 year, uint256 month, uint256 day) {
        int256 __days = int256(_days);

        int256 L = __days + 68569 + 2440588;
        int256 N = (4 * L) / 146097;
        L = L - (146097 * N + 3) / 4;
        int256 _year = (4000 * (L + 1)) / 1461001;
        L = L - (1461 * _year) / 4 + 31;
        int256 _month = (80 * L) / 2447;
        int256 _day = L - (2447 * _month) / 80;
        L = _month / 11;
        _month = _month + 2 - (12 * L);
        _year = 100 * (N - 49) + _year + L;

        year = uint256(_year);
        month = uint256(_month);
        day = uint256(_day);
    }
}
