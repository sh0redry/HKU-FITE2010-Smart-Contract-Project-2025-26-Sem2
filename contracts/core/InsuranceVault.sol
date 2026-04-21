// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IERC20.sol";
import "../interfaces/IInsuranceVault.sol";

contract InsuranceVault is IInsuranceVault {
    uint256 public constant BPS = 10_000;
    uint256 public constant SHARE_PRICE_SCALE = 1e18;

    IERC20 public immutable assetToken;

    address public owner;
    address public policyManager;

    address public immutable override settlementAsset;
    uint256 public override totalAssets;
    uint256 public override totalReserved;
    uint256 public override totalShares;
    uint256 public override realizedPremiums;
    uint256 public override totalClaimsPaid;
    uint256 public cumulativeDeposits;
    uint256 public cumulativeWithdrawals;

    mapping(address => uint256) public shareBalance;

    uint256 private _lock;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PolicyManagerUpdated(address indexed previousManager, address indexed newManager);
    event Deposited(address indexed provider, uint256 assets, uint256 sharesMinted);
    event Withdrawn(address indexed provider, uint256 assets, uint256 sharesBurned);
    event LiquidityReserved(uint256 amount, uint256 totalReservedAfter);
    event LiquidityReleased(uint256 amount, uint256 totalReservedAfter);
    event PremiumCollected(address indexed payer, uint256 amount, uint256 realizedPremiumsAfter);
    event ClaimPaid(address indexed beneficiary, uint256 amount, uint256 totalReservedAfter, uint256 claimsPaidAfter);

    error NotOwner();
    error NotPolicyManager();
    error InvalidAddress();
    error InvalidAmount();
    error InsufficientLiquidity();
    error Reentrancy();
    error TokenTransferFailed();

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

    constructor(address initialOwner, address assetTokenAddress) {
        if (initialOwner == address(0) || assetTokenAddress == address(0)) revert InvalidAddress();
        assetToken = IERC20(assetTokenAddress);
        settlementAsset = assetTokenAddress;
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
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

    function deposit(uint256 assetAmount) external override nonReentrant returns (uint256 sharesMinted) {
        if (assetAmount == 0) revert InvalidAmount();

        uint256 currentAssets = totalAssets;
        if (totalShares == 0 || currentAssets == 0) {
            sharesMinted = assetAmount;
        } else {
            sharesMinted = (assetAmount * totalShares) / currentAssets;
        }
        if (sharesMinted == 0) revert InvalidAmount();

        if (!assetToken.transferFrom(msg.sender, address(this), assetAmount)) {
            revert TokenTransferFailed();
        }

        totalAssets = currentAssets + assetAmount;
        totalShares += sharesMinted;
        shareBalance[msg.sender] += sharesMinted;
        cumulativeDeposits += assetAmount;

        emit Deposited(msg.sender, assetAmount, sharesMinted);
    }

    function withdraw(uint256 shareAmount) external override nonReentrant returns (uint256 assetsOut) {
        if (shareAmount == 0) revert InvalidAmount();
        if (shareAmount > shareBalance[msg.sender]) revert InsufficientLiquidity();

        assetsOut = (shareAmount * totalAssets) / totalShares;
        if (assetsOut > availableLiquidity()) revert InsufficientLiquidity();

        shareBalance[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalAssets -= assetsOut;
        cumulativeWithdrawals += assetsOut;

        if (!assetToken.transfer(msg.sender, assetsOut)) revert TokenTransferFailed();

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

    function sharePrice() public view override returns (uint256) {
        if (totalShares == 0) {
            return SHARE_PRICE_SCALE;
        }
        return (totalAssets * SHARE_PRICE_SCALE) / totalShares;
    }

    function netUnderwritingResult() public view override returns (int256) {
        return int256(realizedPremiums) - int256(totalClaimsPaid);
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

    function collectPremium(address payer, uint256 amount) external override onlyPolicyManager {
        if (payer == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        if (!assetToken.transferFrom(payer, address(this), amount)) revert TokenTransferFailed();

        totalAssets += amount;
        realizedPremiums += amount;
        emit PremiumCollected(payer, amount, realizedPremiums);
    }

    function payClaim(address beneficiary, uint256 amount)
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
        totalClaimsPaid += amount;

        if (!assetToken.transfer(beneficiary, amount)) revert TokenTransferFailed();

        emit ClaimPaid(beneficiary, amount, totalReserved, totalClaimsPaid);
    }
}
