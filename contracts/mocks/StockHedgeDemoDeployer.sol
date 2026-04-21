// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../core/InsuranceVault.sol";
import "../core/PolicyFactory.sol";
import "../engines/PricingOracle.sol";
import "./MockPriceFeed.sol";

contract StockHedgeDemoDeployer {
    bytes32 public constant AAPL = bytes32("AAPL");

    MockPriceFeed public immutable aaplSpotFeed;
    MockPriceFeed public immutable aaplVolFeed;
    PricingOracle public immutable pricingOracle;
    InsuranceVault public immutable insuranceVault;
    PolicyFactory public immutable policyFactory;

    error InvalidOwner();

    constructor(address finalOwner) {
        if (finalOwner == address(0)) revert InvalidOwner();

        aaplSpotFeed = new MockPriceFeed(185e8, 8, finalOwner);
        aaplVolFeed = new MockPriceFeed(2_800, 2, finalOwner);

        pricingOracle = new PricingOracle(address(this));
        insuranceVault = new InsuranceVault(address(this));
        policyFactory = new PolicyFactory(finalOwner, address(insuranceVault), address(pricingOracle));

        pricingOracle.configureMarket(
            AAPL,
            address(aaplSpotFeed),
            address(aaplVolFeed),
            1 hours,
            30 days,
            150,
            50 ether,
            120,
            90,
            570,
            960,
            false,
            true
        );

        insuranceVault.setPolicyManager(address(policyFactory));
        pricingOracle.transferOwnership(finalOwner);
        insuranceVault.transferOwnership(finalOwner);
    }
}
