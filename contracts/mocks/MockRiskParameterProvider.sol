// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IRiskParameterProvider.sol";

contract MockRiskParameterProvider is IRiskParameterProvider {
    address public owner;
    mapping(bytes32 => RiskSnapshot) private snapshots;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RiskSnapshotUpdated(
        bytes32 indexed symbol,
        uint256 impliedVolBps,
        uint256 riskScoreBps,
        bytes32 indexed sourceTag
    );

    error NotOwner();
    error InvalidAddress();
    error InvalidSnapshot();

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

    function setRiskSnapshot(bytes32 symbol, RiskSnapshot calldata snapshot) external onlyOwner {
        if (
            snapshot.impliedVolBps == 0 ||
            snapshot.shortTermMultiplierBps == 0 ||
            snapshot.mediumTermMultiplierBps == 0 ||
            snapshot.longTermMultiplierBps == 0
        ) {
            revert InvalidSnapshot();
        }

        snapshots[symbol] = snapshot;
        emit RiskSnapshotUpdated(symbol, snapshot.impliedVolBps, snapshot.riskScoreBps, snapshot.sourceTag);
    }

    function getRiskSnapshot(bytes32 symbol) external view override returns (RiskSnapshot memory snapshot) {
        return snapshots[symbol];
    }
}
