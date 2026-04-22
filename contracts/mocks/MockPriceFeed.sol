// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPriceFeed.sol";

contract MockPriceFeed is IPriceFeed {
    int256 private _answer;
    uint8 private immutable _decimals;
    uint80 private _roundId;
    uint256 private _updatedAt;
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
        _roundId = 1;
        _updatedAt = block.timestamp;
        owner = initialOwner;
    }

    function setAnswer(int256 newAnswer) external onlyOwner {
        if (newAnswer <= 0) revert InvalidAnswer();
        _answer = newAnswer;
        _roundId += 1;
        _updatedAt = block.timestamp;
    }

    function setAnswerWithTimestamp(int256 newAnswer, uint256 updatedAt_) external onlyOwner {
        if (newAnswer <= 0 || updatedAt_ == 0) revert InvalidAnswer();
        _answer = newAnswer;
        _roundId += 1;
        _updatedAt = updatedAt_;
    }

    function latestAnswer() external view override returns (int256) {
        return _answer;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}
