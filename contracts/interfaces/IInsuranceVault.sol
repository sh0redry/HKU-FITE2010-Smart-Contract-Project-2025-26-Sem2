// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IInsuranceVault {
    function totalAssets() external view returns (uint256);

    function totalReserved() external view returns (uint256);

    function utilizationBps() external view returns (uint256);

    function availableLiquidity() external view returns (uint256);

    function deposit() external payable returns (uint256 sharesMinted);

    function withdraw(uint256 shareAmount) external returns (uint256 assetsOut);

    function reserveLiquidity(uint256 amount) external;

    function releaseLiquidity(uint256 amount) external;

    function collectPremium() external payable;

    function payClaim(address payable beneficiary, uint256 amount) external;
}
