// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRiskParameterProvider {
    struct RiskSnapshot {
        uint256 impliedVolBps;
        uint256 downsideSkewBps;
        uint256 upsideSkewBps;
        uint256 shortTermMultiplierBps;
        uint256 mediumTermMultiplierBps;
        uint256 longTermMultiplierBps;
        uint256 downsideInventoryPressureBps;
        uint256 upsideInventoryPressureBps;
        uint256 stressPremiumBps;
        uint256 riskScoreBps;
        uint256 updatedAt;
        bytes32 sourceTag;
    }

    function getRiskSnapshot(bytes32 symbol) external view returns (RiskSnapshot memory snapshot);
}
