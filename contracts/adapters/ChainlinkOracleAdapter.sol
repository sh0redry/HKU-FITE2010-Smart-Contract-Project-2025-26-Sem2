// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IOracleAdapter.sol";
import "../interfaces/IChainlinkAggregator.sol";

contract ChainlinkOracleAdapter is IOracleAdapter {
    uint256 private constant MAX_DECIMALS = 18;

    struct FeedConfig {
        address primaryFeed;
        address fallbackFeed;
        uint256 maxStaleness;
        bool isActive;
    }

    address public owner;
    mapping(bytes32 => FeedConfig) public feedConfigs;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeedConfigured(
        bytes32 indexed symbol,
        address indexed primaryFeed,
        address indexed fallbackFeed,
        uint256 maxStaleness
    );

    error NotOwner();
    error InvalidAddress();
    error InvalidConfig();

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

    function configureFeed(bytes32 symbol, FeedConfig calldata config) external onlyOwner {
        if (config.primaryFeed == address(0)) revert InvalidAddress();
        if (config.maxStaleness == 0) revert InvalidConfig();

        feedConfigs[symbol] = config;
        emit FeedConfigured(symbol, config.primaryFeed, config.fallbackFeed, config.maxStaleness);
    }

    function getPrice(bytes32 symbol) external view override returns (OracleResponse memory response) {
        FeedConfig memory config = feedConfigs[symbol];
        if (!config.isActive) {
            return response;
        }

        response = _readFeed(config.primaryFeed, config.maxStaleness, false);
        if (response.isValid) {
            return response;
        }

        if (config.fallbackFeed != address(0)) {
            response = _readFeed(config.fallbackFeed, config.maxStaleness, true);
        }
    }

    function _readFeed(address feed, uint256 maxStaleness, bool usedFallback)
        internal
        view
        returns (OracleResponse memory response)
    {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = IChainlinkAggregator(feed).latestRoundData();

        if (
            answer <= 0 ||
            updatedAt == 0 ||
            block.timestamp < updatedAt ||
            block.timestamp - updatedAt > maxStaleness ||
            answeredInRound < roundId
        ) {
            return response;
        }

        uint256 normalizedPrice = uint256(answer);
        uint8 feedDecimals = IChainlinkAggregator(feed).decimals();
        if (feedDecimals > MAX_DECIMALS) {
            normalizedPrice /= 10 ** (feedDecimals - MAX_DECIMALS);
        } else if (feedDecimals < MAX_DECIMALS) {
            normalizedPrice *= 10 ** (MAX_DECIMALS - feedDecimals);
        }

        response = OracleResponse({
            price: normalizedPrice,
            updatedAt: updatedAt,
            isValid: true,
            usedFallback: usedFallback,
            sourceTag: usedFallback ? bytes32("CHAINLINK_FALLBACK") : bytes32("CHAINLINK_PRIMARY")
        });
    }
}
