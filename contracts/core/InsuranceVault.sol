// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20 as OZIERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IInsuranceVault.sol";

/// @title InsuranceVault
/// @notice ERC20 settlement vault for LP deposits, reserved claim capital, premium income, and claim payments.
/// @dev Only the configured policy manager can reserve/release capital, collect premiums, and pay claims.
contract InsuranceVault is IInsuranceVault, Ownable, ReentrancyGuard {
    using SafeERC20 for OZIERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant SHARE_PRICE_SCALE = 1e18;

    OZIERC20 public immutable assetToken;

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

    event PolicyManagerUpdated(address indexed previousManager, address indexed newManager);
    event Deposited(address indexed provider, uint256 assets, uint256 sharesMinted);
    event Withdrawn(address indexed provider, uint256 assets, uint256 sharesBurned);
    event LiquidityReserved(uint256 amount, uint256 totalReservedAfter);
    event LiquidityReleased(uint256 amount, uint256 totalReservedAfter);
    event PremiumCollected(address indexed payer, uint256 amount, uint256 realizedPremiumsAfter);
    event ClaimPaid(address indexed beneficiary, uint256 amount, uint256 totalReservedAfter, uint256 claimsPaidAfter);

    error NotPolicyManager();
    error InvalidAddress();
    error InvalidAmount();
    error InsufficientLiquidity();
    error TokenTransferFailed();

    modifier onlyPolicyManager() {
        if (msg.sender != policyManager) revert NotPolicyManager();
        _;
    }

    constructor(address initialOwner, address assetTokenAddress) Ownable(initialOwner) {
        if (initialOwner == address(0) || assetTokenAddress == address(0)) revert InvalidAddress();
        assetToken = OZIERC20(assetTokenAddress);
        settlementAsset = assetTokenAddress;
    }

    /// @notice Sets the only contract allowed to manage policy reserves and claims.
    /// @dev This should be the deployed PolicyFactory address.
    function setPolicyManager(address newPolicyManager) external onlyOwner {
        if (newPolicyManager == address(0)) revert InvalidAddress();
        emit PolicyManagerUpdated(policyManager, newPolicyManager);
        policyManager = newPolicyManager;
    }

    /// @notice Deposits settlement assets and mints proportional LP shares.
    /// @param assetAmount Amount of settlement ERC20 tokens to deposit.
    /// @return sharesMinted Number of vault shares minted to the LP.
    function deposit(uint256 assetAmount) external override nonReentrant returns (uint256 sharesMinted) {
        if (assetAmount == 0) revert InvalidAmount();

        uint256 currentAssets = totalAssets;
        if (totalShares == 0 || currentAssets == 0) {
            sharesMinted = assetAmount;
        } else {
            sharesMinted = (assetAmount * totalShares) / currentAssets;
        }
        if (sharesMinted == 0) revert InvalidAmount();

        assetToken.safeTransferFrom(msg.sender, address(this), assetAmount);

        totalAssets = currentAssets + assetAmount;
        totalShares += sharesMinted;
        shareBalance[msg.sender] += sharesMinted;
        cumulativeDeposits += assetAmount;

        emit Deposited(msg.sender, assetAmount, sharesMinted);
    }

    /// @notice Burns LP shares and withdraws the corresponding unlocked assets.
    /// @dev Withdrawals cannot use assets that are reserved for active policy maximum payouts.
    /// @param shareAmount Vault shares to burn.
    /// @return assetsOut Settlement tokens returned to the LP.
    function withdraw(uint256 shareAmount) external override nonReentrant returns (uint256 assetsOut) {
        if (shareAmount == 0) revert InvalidAmount();
        if (shareAmount > shareBalance[msg.sender]) revert InsufficientLiquidity();

        assetsOut = (shareAmount * totalAssets) / totalShares;
        if (assetsOut > availableLiquidity()) revert InsufficientLiquidity();

        shareBalance[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalAssets -= assetsOut;
        cumulativeWithdrawals += assetsOut;

        assetToken.safeTransfer(msg.sender, assetsOut);

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

    /// @notice Locks available liquidity as maximum claim reserve for a new policy.
    /// @param amount Amount of settlement asset reserved.
    function reserveLiquidity(uint256 amount) external override onlyPolicyManager {
        if (amount == 0) revert InvalidAmount();
        if (amount > availableLiquidity()) revert InsufficientLiquidity();

        totalReserved += amount;
        emit LiquidityReserved(amount, totalReserved);
    }

    /// @notice Releases unused reserved liquidity after cancellation or settlement.
    /// @param amount Amount of settlement asset to unlock.
    function releaseLiquidity(uint256 amount) external override onlyPolicyManager {
        if (amount == 0) revert InvalidAmount();
        if (amount > totalReserved) revert InsufficientLiquidity();

        totalReserved -= amount;
        emit LiquidityReleased(amount, totalReserved);
    }

    /// @notice Pulls a buyer premium into the vault and records realized underwriting income.
    /// @param payer Buyer paying the premium.
    /// @param amount Premium amount in settlement asset units.
    function collectPremium(address payer, uint256 amount) external override onlyPolicyManager {
        if (payer == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();

        assetToken.safeTransferFrom(payer, address(this), amount);

        totalAssets += amount;
        realizedPremiums += amount;
        emit PremiumCollected(payer, amount, realizedPremiums);
    }

    /// @notice Pays a triggered policy claim to the beneficiary from reserved capital.
    /// @param beneficiary Policy holder receiving the claim.
    /// @param amount Claim amount in settlement asset units.
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

        assetToken.safeTransfer(beneficiary, amount);

        emit ClaimPaid(beneficiary, amount, totalReserved, totalClaimsPaid);
    }
}
