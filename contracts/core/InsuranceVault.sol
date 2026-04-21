// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IInsuranceVault.sol";

contract InsuranceVault is IInsuranceVault {
    uint256 public constant BPS = 10_000;

    address public owner;
    address public policyManager;

    uint256 public override totalAssets;
    uint256 public override totalReserved;
    uint256 public totalShares;

    mapping(address => uint256) public shareBalance;

    uint256 private _lock;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PolicyManagerUpdated(address indexed previousManager, address indexed newManager);
    event Deposited(address indexed provider, uint256 assets, uint256 sharesMinted);
    event Withdrawn(address indexed provider, uint256 assets, uint256 sharesBurned);
    event LiquidityReserved(uint256 amount, uint256 totalReservedAfter);
    event LiquidityReleased(uint256 amount, uint256 totalReservedAfter);
    event PremiumCollected(address indexed payer, uint256 amount);
    event ClaimPaid(address indexed beneficiary, uint256 amount, uint256 totalReservedAfter);

    error NotOwner();
    error NotPolicyManager();
    error InvalidAddress();
    error InvalidAmount();
    error InsufficientLiquidity();
    error Reentrancy();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPolicyManager() {
        if (msg.sender != policyManager) revert NotPolicyManager();
        _;
    }

    modifier nonReentrant() {
        if (_lock == 1) revert Reentrancy();
        _lock = 1;
        _;
        _lock = 0;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    receive() external payable {
        collectPremium();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPolicyManager(address newPolicyManager) external onlyOwner {
        if (newPolicyManager == address(0)) revert InvalidAddress();
        emit PolicyManagerUpdated(policyManager, newPolicyManager);
        policyManager = newPolicyManager;
    }

    function deposit() external payable nonReentrant returns (uint256 sharesMinted) {
        if (msg.value == 0) revert InvalidAmount();

        uint256 currentAssets = totalAssets;
        if (totalShares == 0 || currentAssets == 0) {
            sharesMinted = msg.value;
        } else {
            sharesMinted = (msg.value * totalShares) / currentAssets;
        }

        totalAssets = currentAssets + msg.value;
        totalShares += sharesMinted;
        shareBalance[msg.sender] += sharesMinted;

        emit Deposited(msg.sender, msg.value, sharesMinted);
    }

    function withdraw(uint256 shareAmount) external nonReentrant returns (uint256 assetsOut) {
        if (shareAmount == 0) revert InvalidAmount();
        if (shareAmount > shareBalance[msg.sender]) revert InsufficientLiquidity();

        assetsOut = (shareAmount * totalAssets) / totalShares;
        if (assetsOut > availableLiquidity()) revert InsufficientLiquidity();

        shareBalance[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalAssets -= assetsOut;

        (bool success, ) = payable(msg.sender).call{value: assetsOut}("");
        if (!success) revert TransferFailed();

        emit Withdrawn(msg.sender, assetsOut, shareAmount);
    }

    function utilizationBps() public view override returns (uint256) {
        if (totalAssets == 0) {
            return 0;
        }
        return (totalReserved * BPS) / totalAssets;
    }

    function availableLiquidity() public view override returns (uint256) {
        return totalAssets - totalReserved;
    }

    function reserveLiquidity(uint256 amount) external override onlyPolicyManager {
        if (amount == 0) revert InvalidAmount();
        if (amount > availableLiquidity()) revert InsufficientLiquidity();

        totalReserved += amount;
        emit LiquidityReserved(amount, totalReserved);
    }

    function releaseLiquidity(uint256 amount) external override onlyPolicyManager {
        if (amount == 0) revert InvalidAmount();
        if (amount > totalReserved) revert InsufficientLiquidity();

        totalReserved -= amount;
        emit LiquidityReleased(amount, totalReserved);
    }

    function collectPremium() public payable override {
        if (msg.value == 0) revert InvalidAmount();
        totalAssets += msg.value;
        emit PremiumCollected(msg.sender, msg.value);
    }

    function payClaim(address payable beneficiary, uint256 amount)
        external
        override
        onlyPolicyManager
        nonReentrant
    {
        if (beneficiary == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (amount > totalReserved || amount > totalAssets) revert InsufficientLiquidity();

        totalReserved -= amount;
        totalAssets -= amount;

        (bool success, ) = beneficiary.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ClaimPaid(beneficiary, amount, totalReserved);
    }
}
