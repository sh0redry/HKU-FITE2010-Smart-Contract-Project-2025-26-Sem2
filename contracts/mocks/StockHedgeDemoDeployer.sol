// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../core/InsuranceVault.sol";
import "../core/PolicyFactory.sol";
import "../automation/PolicySettlementAutomation.sol";
import "../adapters/ChainlinkOracleAdapter.sol";
import "../engines/PricingOracle.sol";
import "../interfaces/IPricingEngine.sol";
import "../interfaces/IRiskParameterProvider.sol";
import "./MockPriceFeed.sol";
import "./MockRiskParameterProvider.sol";
import "./MockUSDC.sol";

contract StockHedgeDemoDeployer {
    bytes32 public constant AAPL = bytes32("AAPL");
    bytes32 public constant TSLA = bytes32("TSLA");
    bytes32 public constant NVDA = bytes32("NVDA");
    bytes32 public constant MSFT = bytes32("MSFT");
    uint256 public constant INITIAL_USER_BALANCE = 100_000e6;
    uint8 private constant SETTLEMENT_MODE_NEXT_OPEN = 1;

    MockUSDC public immutable mockUsdc;
    MockRiskParameterProvider public immutable riskParameterProvider;
    ChainlinkOracleAdapter public immutable oracleAdapter;
    MockPriceFeed public immutable aaplSpotFeed;
    MockPriceFeed public immutable tslaSpotFeed;
    MockPriceFeed public immutable nvdaSpotFeed;
    MockPriceFeed public immutable msftSpotFeed;
    PricingOracle public immutable pricingOracle;
    InsuranceVault public immutable insuranceVault;
    PolicyFactory public immutable policyFactory;
    PolicySettlementAutomation public immutable settlementAutomation;

    error InvalidOwner();

    constructor(address finalOwner) {
        if (finalOwner == address(0)) revert InvalidOwner();

        mockUsdc = new MockUSDC(address(this));
        riskParameterProvider = new MockRiskParameterProvider(address(this));
        oracleAdapter = new ChainlinkOracleAdapter(address(this));
        aaplSpotFeed = new MockPriceFeed(185e8, 8, finalOwner);
        tslaSpotFeed = new MockPriceFeed(172e8, 8, finalOwner);
        nvdaSpotFeed = new MockPriceFeed(890e8, 8, finalOwner);
        msftSpotFeed = new MockPriceFeed(415e8, 8, finalOwner);

        pricingOracle = new PricingOracle(address(this), address(riskParameterProvider), address(oracleAdapter));
        insuranceVault = new InsuranceVault(address(this), address(mockUsdc));
        policyFactory = new PolicyFactory(finalOwner, address(insuranceVault), address(pricingOracle));
        settlementAutomation = new PolicySettlementAutomation(address(policyFactory), 10);

        oracleAdapter.configureFeed(AAPL, _feedConfig(address(aaplSpotFeed)));
        oracleAdapter.configureFeed(TSLA, _feedConfig(address(tslaSpotFeed)));
        oracleAdapter.configureFeed(NVDA, _feedConfig(address(nvdaSpotFeed)));
        oracleAdapter.configureFeed(MSFT, _feedConfig(address(msftSpotFeed)));

        pricingOracle.configureMarket(AAPL, _marketConfig(150));
        pricingOracle.configureMarket(TSLA, _marketConfig(190));
        pricingOracle.configureMarket(NVDA, _marketConfig(175));
        pricingOracle.configureMarket(MSFT, _marketConfig(135));

        riskParameterProvider.setRiskSnapshot(AAPL, _riskSnapshot(2800, 120, 90, 10250, 10000, 9650, 80, 45, 55, 6200, "MANUAL_AAPL"));
        riskParameterProvider.setRiskSnapshot(TSLA, _riskSnapshot(4200, 180, 140, 10800, 10300, 9800, 130, 90, 85, 7600, "MANUAL_TSLA"));
        riskParameterProvider.setRiskSnapshot(NVDA, _riskSnapshot(3600, 150, 120, 10550, 10150, 9750, 110, 70, 70, 7100, "MANUAL_NVDA"));
        riskParameterProvider.setRiskSnapshot(MSFT, _riskSnapshot(2100, 100, 85, 10150, 9950, 9700, 60, 35, 40, 5400, "MANUAL_MSFT"));

        insuranceVault.setPolicyManager(address(policyFactory));
        pricingOracle.transferOwnership(finalOwner);
        insuranceVault.transferOwnership(finalOwner);
        mockUsdc.mint(finalOwner, INITIAL_USER_BALANCE);
        mockUsdc.transferOwnership(finalOwner);
        riskParameterProvider.transferOwnership(finalOwner);
    }

    function _marketConfig(
        uint256 basePremiumBps
    ) internal pure returns (PricingOracle.MarketConfigInput memory marketConfig) {
        marketConfig = PricingOracle.MarketConfigInput({
            minDuration: 1 hours,
            maxDuration: 30 days,
            basePremiumBps: basePremiumBps,
            maxNotional: 50_000e6,
            minTriggerBps: 500,
            maxTriggerBps: 2_000,
            openMinutesLocal: 570,
            closeMinutesLocal: 960,
            closeBufferMinutes: 15,
            overnightGapSurchargeBps: 120,
            enforceMarketHours: false,
            useUsEquityCalendar: true,
            allowFallbackOracle: true,
            settlementMode: IPricingEngine.SettlementMode(SETTLEMENT_MODE_NEXT_OPEN),
            isActive: true
        });
    }

    function _feedConfig(address primaryFeed)
        internal
        pure
        returns (ChainlinkOracleAdapter.FeedConfig memory config)
    {
        config = ChainlinkOracleAdapter.FeedConfig({
            primaryFeed: primaryFeed,
            fallbackFeed: address(0),
            maxStaleness: 1 days,
            isActive: true
        });
    }

    function _riskSnapshot(
        uint256 impliedVolBps,
        uint256 downsideSkewBps,
        uint256 upsideSkewBps,
        uint256 shortTermMultiplierBps,
        uint256 mediumTermMultiplierBps,
        uint256 longTermMultiplierBps,
        uint256 downsideInventoryPressureBps,
        uint256 upsideInventoryPressureBps,
        uint256 stressPremiumBps,
        uint256 riskScoreBps,
        bytes32 sourceTag
    ) internal view returns (IRiskParameterProvider.RiskSnapshot memory snapshot) {
        snapshot = IRiskParameterProvider.RiskSnapshot({
            impliedVolBps: impliedVolBps,
            downsideSkewBps: downsideSkewBps,
            upsideSkewBps: upsideSkewBps,
            shortTermMultiplierBps: shortTermMultiplierBps,
            mediumTermMultiplierBps: mediumTermMultiplierBps,
            longTermMultiplierBps: longTermMultiplierBps,
            downsideInventoryPressureBps: downsideInventoryPressureBps,
            upsideInventoryPressureBps: upsideInventoryPressureBps,
            stressPremiumBps: stressPremiumBps,
            riskScoreBps: riskScoreBps,
            updatedAt: block.timestamp,
            sourceTag: sourceTag
        });
    }
}
