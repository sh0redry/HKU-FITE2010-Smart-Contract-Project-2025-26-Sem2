// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../core/InsuranceVault.sol";
import "../core/PolicyFactory.sol";
import "../engines/PricingOracle.sol";
import "./MockPriceFeed.sol";
import "./MockUSDC.sol";

contract StockHedgeDemoDeployer {
    bytes32 public constant AAPL = bytes32("AAPL");
    bytes32 public constant TSLA = bytes32("TSLA");
    bytes32 public constant NVDA = bytes32("NVDA");
    bytes32 public constant MSFT = bytes32("MSFT");
    uint256 public constant INITIAL_USER_BALANCE = 100_000e6;

    MockUSDC public immutable mockUsdc;
    MockPriceFeed public immutable aaplSpotFeed;
    MockPriceFeed public immutable aaplVolFeed;
    MockPriceFeed public immutable tslaSpotFeed;
    MockPriceFeed public immutable tslaVolFeed;
    MockPriceFeed public immutable nvdaSpotFeed;
    MockPriceFeed public immutable nvdaVolFeed;
    MockPriceFeed public immutable msftSpotFeed;
    MockPriceFeed public immutable msftVolFeed;
    PricingOracle public immutable pricingOracle;
    InsuranceVault public immutable insuranceVault;
    PolicyFactory public immutable policyFactory;

    error InvalidOwner();

    constructor(address finalOwner) {
        if (finalOwner == address(0)) revert InvalidOwner();

        mockUsdc = new MockUSDC(address(this));
        aaplSpotFeed = new MockPriceFeed(185e8, 8, finalOwner);
        aaplVolFeed = new MockPriceFeed(2_800, 2, finalOwner);
        tslaSpotFeed = new MockPriceFeed(172e8, 8, finalOwner);
        tslaVolFeed = new MockPriceFeed(4_200, 2, finalOwner);
        nvdaSpotFeed = new MockPriceFeed(890e8, 8, finalOwner);
        nvdaVolFeed = new MockPriceFeed(3_600, 2, finalOwner);
        msftSpotFeed = new MockPriceFeed(415e8, 8, finalOwner);
        msftVolFeed = new MockPriceFeed(2_100, 2, finalOwner);

        pricingOracle = new PricingOracle(address(this));
        insuranceVault = new InsuranceVault(address(this), address(mockUsdc));
        policyFactory = new PolicyFactory(finalOwner, address(insuranceVault), address(pricingOracle));

        pricingOracle.configureMarket(AAPL, _marketConfig(address(aaplSpotFeed), address(aaplVolFeed), 150, 120, 90));
        pricingOracle.configureMarket(TSLA, _marketConfig(address(tslaSpotFeed), address(tslaVolFeed), 190, 180, 140));
        pricingOracle.configureMarket(NVDA, _marketConfig(address(nvdaSpotFeed), address(nvdaVolFeed), 175, 150, 120));
        pricingOracle.configureMarket(MSFT, _marketConfig(address(msftSpotFeed), address(msftVolFeed), 135, 100, 85));

        insuranceVault.setPolicyManager(address(policyFactory));
        pricingOracle.transferOwnership(finalOwner);
        insuranceVault.transferOwnership(finalOwner);
        mockUsdc.mint(finalOwner, INITIAL_USER_BALANCE);
        mockUsdc.transferOwnership(finalOwner);
    }

    function _marketConfig(
        address spotFeed,
        address volFeed,
        uint256 basePremiumBps,
        uint256 downsideRiskBps,
        uint256 upsideRiskBps
    ) internal pure returns (PricingOracle.MarketConfigInput memory marketConfig) {
        marketConfig = PricingOracle.MarketConfigInput({
            spotFeed: spotFeed,
            volFeed: volFeed,
            minDuration: 1 hours,
            maxDuration: 30 days,
            basePremiumBps: basePremiumBps,
            maxNotional: 50_000e6,
            downsideRiskBps: downsideRiskBps,
            upsideRiskBps: upsideRiskBps,
            minTriggerBps: 500,
            maxTriggerBps: 2_000,
            openMinutesUtc: 570,
            closeMinutesUtc: 960,
            enforceMarketHours: false,
            isActive: true
        });
    }
}
