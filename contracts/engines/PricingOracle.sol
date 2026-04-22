// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

import "../interfaces/IPricingEngine.sol";
import "../interfaces/IOracleAdapter.sol";
import "../interfaces/IRiskParameterProvider.sol";

contract PricingOracle is IPricingEngine, AccessControl, Pausable {
    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    uint256 private constant DAY = 1 days;
    uint256 private constant SHORT_TERM_MAX = 7 days;
    uint256 private constant MEDIUM_TERM_MAX = 21 days;
    uint256 private constant HONG_KONG_OFFSET = 8 hours;
    uint256 private constant US_STANDARD_ABS_OFFSET = 5 hours;
    uint256 private constant US_DAYLIGHT_ABS_OFFSET = 4 hours;

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant RISK_MANAGER_ROLE = keccak256("RISK_MANAGER_ROLE");
    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum MarketCalendar {
        None,
        UsEquity,
        HongKongEquity
    }

    struct MarketConfig {
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
        bool allowFallbackOracle;
        SettlementMode settlementMode;
        MarketCalendar calendarType;
        bool isActive;
    }

    struct MarketConfigInput {
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
        bool allowFallbackOracle;
        SettlementMode settlementMode;
        MarketCalendar calendarType;
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

    address public override riskParameterProvider;
    address public override oracleAdapter;

    mapping(bytes32 => MarketConfig) private marketConfigs;
    mapping(uint8 => mapping(uint256 => bool)) public calendarClosures;

    event MarketConfigured(bytes32 indexed symbol, uint256 basePremiumBps, uint256 maxNotional);
    event RiskParameterProviderUpdated(address indexed previousProvider, address indexed newProvider);
    event OracleAdapterUpdated(address indexed previousAdapter, address indexed newAdapter);
    event CalendarClosureUpdated(uint8 indexed calendarType, uint256 indexed dateKey, bool isClosed);

    error MarketInactive(bytes32 symbol);
    error InvalidDuration();
    error NotionalTooLarge();
    error InvalidUtilization();
    error InvalidTrigger();
    error InvalidPayoutTerms();
    error MarketClosed(bytes32 symbol);
    error MarketClosingSoon(bytes32 symbol);
    error InvalidRiskProvider();
    error InvalidOracleAdapter();
    error MissingRiskSnapshot(bytes32 symbol);
    error SettlementPricePending(bytes32 symbol, uint256 effectiveTimestamp);
    error OracleUnavailable(bytes32 symbol);
    error FallbackOracleDisabled(bytes32 symbol);

    constructor(address governor, address riskParameterProviderAddress, address oracleAdapterAddress) {
        if (governor == address(0) || riskParameterProviderAddress == address(0) || oracleAdapterAddress == address(0)) {
            revert InvalidOracleAdapter();
        }

        riskParameterProvider = riskParameterProviderAddress;
        oracleAdapter = oracleAdapterAddress;

        _grantRole(DEFAULT_ADMIN_ROLE, governor);
        _grantRole(GOVERNOR_ROLE, governor);
        _grantRole(RISK_MANAGER_ROLE, governor);
        _grantRole(ORACLE_MANAGER_ROLE, governor);
        _grantRole(PAUSER_ROLE, governor);
    }

    function pauseQuoting() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpauseQuoting() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }

    function setRiskParameterProvider(address newProvider) external onlyRole(ORACLE_MANAGER_ROLE) {
        if (newProvider == address(0)) revert InvalidRiskProvider();
        emit RiskParameterProviderUpdated(riskParameterProvider, newProvider);
        riskParameterProvider = newProvider;
    }

    function setOracleAdapter(address newAdapter) external onlyRole(ORACLE_MANAGER_ROLE) {
        if (newAdapter == address(0)) revert InvalidOracleAdapter();
        emit OracleAdapterUpdated(oracleAdapter, newAdapter);
        oracleAdapter = newAdapter;
    }

    function configureMarket(bytes32 symbol, MarketConfigInput calldata config) external onlyRole(RISK_MANAGER_ROLE) {
        if (config.minDuration == 0 || config.maxDuration < config.minDuration) revert InvalidDuration();
        if (config.openMinutesLocal >= DAY / 1 minutes || config.closeMinutesLocal >= DAY / 1 minutes) {
            revert InvalidDuration();
        }
        if (config.closeMinutesLocal <= config.openMinutesLocal) revert InvalidDuration();
        if (config.closeBufferMinutes >= config.closeMinutesLocal - config.openMinutesLocal) revert InvalidDuration();
        if (config.minTriggerBps < 500 || config.maxTriggerBps > 2_000 || config.maxTriggerBps < config.minTriggerBps) {
            revert InvalidTrigger();
        }

        marketConfigs[symbol] = MarketConfig({
            minDuration: config.minDuration,
            maxDuration: config.maxDuration,
            basePremiumBps: config.basePremiumBps,
            maxNotional: config.maxNotional,
            minTriggerBps: config.minTriggerBps,
            maxTriggerBps: config.maxTriggerBps,
            openMinutesLocal: config.openMinutesLocal,
            closeMinutesLocal: config.closeMinutesLocal,
            closeBufferMinutes: config.closeBufferMinutes,
            overnightGapSurchargeBps: config.overnightGapSurchargeBps,
            enforceMarketHours: config.enforceMarketHours,
            allowFallbackOracle: config.allowFallbackOracle,
            settlementMode: config.settlementMode,
            calendarType: config.calendarType,
            isActive: config.isActive
        });

        emit MarketConfigured(symbol, config.basePremiumBps, config.maxNotional);
    }

    function setCalendarClosure(MarketCalendar calendarType, uint256 dateKey, bool isClosed)
        external
        onlyRole(RISK_MANAGER_ROLE)
    {
        calendarClosures[uint8(calendarType)][dateKey] = isClosed;
        emit CalendarClosureUpdated(uint8(calendarType), dateKey, isClosed);
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
    ) external view override whenNotPaused returns (PremiumQuote memory quote) {
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

        IOracleAdapter.OracleResponse memory oracleResponse = _readSpotOracle(symbol, config.allowFallbackOracle);
        uint256 spotPrice = oracleResponse.price;
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
            oracleUpdatedAt: oracleResponse.updatedAt,
            triggerBps: triggerBps,
            isDownsideProtection: isDownsideProtection,
            oracleUsedFallback: oracleResponse.usedFallback,
            settlesAtNextOpen: effectiveSettlementTime > scheduledExpiry,
            expiry: scheduledExpiry,
            effectiveSettlementTime: effectiveSettlementTime,
            oracleSourceTag: oracleResponse.sourceTag
        });
    }

    function getSpotPrice(bytes32 symbol) external view override returns (uint256) {
        MarketConfig storage config = marketConfigs[symbol];
        if (!config.isActive) revert MarketInactive(symbol);
        return _readSpotOracle(symbol, config.allowFallbackOracle).price;
    }

    function getSettlementPrice(bytes32 symbol, uint256 scheduledExpiry)
        external
        view
        override
        returns (uint256 price, uint256 effectiveTimestamp)
    {
        MarketConfig storage config = marketConfigs[symbol];
        if (!config.isActive) revert MarketInactive(symbol);

        effectiveTimestamp = _effectiveSettlementTimestamp(config, scheduledExpiry);
        if (block.timestamp < effectiveTimestamp) revert SettlementPricePending(symbol, effectiveTimestamp);

        price = _readSpotOracle(symbol, config.allowFallbackOracle).price;
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

    function isMarketOpen(bytes32 symbol) external view override returns (bool) {
        MarketConfig storage config = marketConfigs[symbol];
        if (!config.isActive) {
            return false;
        }
        return _sessionContext(config, block.timestamp).isOpen;
    }

    function isSupportedSymbol(bytes32 symbol) external view override returns (bool) {
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
        if (duration <= SHORT_TERM_MAX) return snapshot.shortTermMultiplierBps;
        if (duration <= MEDIUM_TERM_MAX) return snapshot.mediumTermMultiplierBps;
        multiplierBps = snapshot.longTermMultiplierBps;
    }

    function _effectiveSettlementTimestamp(MarketConfig storage config, uint256 scheduledExpiry)
        internal
        view
        returns (uint256 effectiveTimestamp)
    {
        if (config.settlementMode == SettlementMode.CurrentPrice) {
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
        if (config.calendarType == MarketCalendar.None) {
            return false;
        }

        return scheduledExpiry > currentSession.closeTimestamp;
    }

    function _readSpotOracle(bytes32 symbol, bool allowFallback)
        internal
        view
        returns (IOracleAdapter.OracleResponse memory response)
    {
        response = IOracleAdapter(oracleAdapter).getPrice(symbol);
        if (!response.isValid || response.price == 0 || response.updatedAt == 0) revert OracleUnavailable(symbol);
        if (response.usedFallback && !allowFallback) revert FallbackOracleDisabled(symbol);
    }

    function _sessionContext(MarketConfig storage config, uint256 timestamp)
        internal
        view
        returns (SessionContext memory context)
    {
        if (config.calendarType == MarketCalendar.None) {
            uint256 dayOfWeekUtc = ((timestamp / DAY) + 4) % 7;
            if (dayOfWeekUtc == 0 || dayOfWeekUtc == 6) {
                return SessionContext(false, false, 0, 0, 0, 0, 0);
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

        (uint256 year, uint256 month, uint256 day, uint256 minutesLocal, int256 offsetSeconds) =
            _localDateTime(config.calendarType, timestamp);
        uint256 dateKey = (year * 10_000) + (month * 100) + day;
        uint256 weekday = _getDayOfWeek(year, month, day);
        bool isHoliday = calendarClosures[uint8(config.calendarType)][dateKey];
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
            (uint256 year, uint256 month, uint256 day,, int256 offsetSeconds) =
                _localDateTime(config.calendarType, cursor);
            uint256 dateKey = (year * 10_000) + (month * 100) + day;
            uint256 weekday = _getDayOfWeek(year, month, day);

            if (weekday != 0 && weekday != 6 && !calendarClosures[uint8(config.calendarType)][dateKey]) {
                uint256 dayStartUtc = _dayStartUtc(cursor, offsetSeconds);
                openTimestamp = dayStartUtc + (uint256(config.openMinutesLocal) * 1 minutes);
                if (openTimestamp >= timestamp) {
                    return openTimestamp;
                }
            }

            cursor = _dayStartUtc(cursor, offsetSeconds) + DAY + 1;
        }
    }

    function _dayStartUtc(uint256 timestamp, int256 offsetSeconds) internal pure returns (uint256) {
        int256 localTimestamp = int256(timestamp) + offsetSeconds;
        int256 dayStartLocal = (localTimestamp / int256(DAY)) * int256(DAY);
        return uint256(dayStartLocal - offsetSeconds);
    }

    function _localDateTime(MarketCalendar calendarType, uint256 timestamp)
        internal
        pure
        returns (uint256 year, uint256 month, uint256 day, uint256 minutesLocal, int256 offsetSeconds)
    {
        offsetSeconds = _calendarOffsetSeconds(calendarType, timestamp);
        int256 localTimestamp = int256(timestamp) + offsetSeconds;
        (year, month, day) = _daysToDate(uint256(localTimestamp / int256(DAY)));
        minutesLocal = uint256(localTimestamp % int256(DAY)) / 1 minutes;
    }

    function _calendarOffsetSeconds(MarketCalendar calendarType, uint256 timestamp) internal pure returns (int256) {
        if (calendarType == MarketCalendar.UsEquity) {
            return _isUsDaylightSaving(timestamp) ? -int256(US_DAYLIGHT_ABS_OFFSET) : -int256(US_STANDARD_ABS_OFFSET);
        }
        if (calendarType == MarketCalendar.HongKongEquity) {
            return int256(HONG_KONG_OFFSET);
        }
        return 0;
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
