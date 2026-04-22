// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IRiskParameterProvider.sol";

contract MockRiskParameterProvider is IRiskParameterProvider, Ownable {
    mapping(bytes32 => RiskSnapshot) private snapshots;

    event RiskSnapshotUpdated(
        bytes32 indexed symbol,
        uint256 impliedVolBps,
        uint256 riskScoreBps,
        bytes32 indexed sourceTag
    );

    error InvalidAddress();
    error InvalidSnapshot();

    constructor(address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert InvalidAddress();
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
