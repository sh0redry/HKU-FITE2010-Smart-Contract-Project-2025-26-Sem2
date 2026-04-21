// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IInsuranceVault {
    function settlementAsset() external view returns (address);

    function totalAssets() external view returns (uint256);

    function totalReserved() external view returns (uint256);

    function utilizationBps() external view returns (uint256);

    function availableLiquidity() external view returns (uint256);

    function totalShares() external view returns (uint256);

    function realizedPremiums() external view returns (uint256);

    function totalClaimsPaid() external view returns (uint256);

    function sharePrice() external view returns (uint256);

    function netUnderwritingResult() external view returns (int256);

    function deposit(uint256 assetAmount) external returns (uint256 sharesMinted);

    function withdraw(uint256 shareAmount) external returns (uint256 assetsOut);

    function reserveLiquidity(uint256 amount) external;

    function releaseLiquidity(uint256 amount) external;

    function collectPremium(address payer, uint256 amount) external;

    function payClaim(address beneficiary, uint256 amount) external;
}
