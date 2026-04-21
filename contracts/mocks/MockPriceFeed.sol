// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPriceFeed.sol";

contract MockPriceFeed is IPriceFeed {
    int256 private _answer;
    uint8 private immutable _decimals;
    address public owner;

    error NotOwner();
    error InvalidAnswer();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(int256 initialAnswer, uint8 feedDecimals, address initialOwner) {
        if (initialAnswer <= 0) revert InvalidAnswer();
        _answer = initialAnswer;
        _decimals = feedDecimals;
        owner = initialOwner;
    }

    function setAnswer(int256 newAnswer) external onlyOwner {
        if (newAnswer <= 0) revert InvalidAnswer();
        _answer = newAnswer;
    }

    function latestAnswer() external view override returns (int256) {
        return _answer;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }
}
