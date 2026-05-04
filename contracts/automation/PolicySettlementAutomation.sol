// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../core/PolicyFactory.sol";
import "../interfaces/IAutomationCompatible.sol";

/// @title PolicySettlementAutomation
/// @notice Chainlink Automation-compatible helper that scans active policy IDs and settles ready expiries.
/// @dev The underlying PolicyFactory batch settlement skips non-settleable IDs to keep keeper execution robust.
contract PolicySettlementAutomation is IAutomationCompatible {
    PolicyFactory public immutable policyFactory;
    uint256 public immutable defaultBatchSize;

    error InvalidBatchSize();

    constructor(address policyFactoryAddress, uint256 batchSize) {
        if (policyFactoryAddress == address(0) || batchSize == 0) revert InvalidBatchSize();
        policyFactory = PolicyFactory(policyFactoryAddress);
        defaultBatchSize = batchSize;
    }

    /// @notice Finds settleable policies in a cursor-based active-policy batch.
    /// @param checkData Optional abi-encoded `(cursor, batchSize)` pair.
    /// @return upkeepNeeded True when at least one policy can be settled.
    /// @return performData ABI-encoded policy IDs for `performUpkeep`.
    function checkUpkeep(bytes calldata checkData) external view override returns (bool upkeepNeeded, bytes memory performData) {
        (uint256 cursor, uint256 batchSize) = checkData.length == 0
            ? (uint256(0), defaultBatchSize)
            : abi.decode(checkData, (uint256, uint256));

        uint256[] memory batch = policyFactory.getActivePolicyIds(cursor, batchSize == 0 ? defaultBatchSize : batchSize);
        uint256[] memory settleable = new uint256[](batch.length);
        uint256 count;

        uint256 batchLength = batch.length;
        for (uint256 i = 0; i < batchLength;) {
            if (policyFactory.isPolicySettleable(batch[i])) {
                settleable[count] = batch[i];
                count++;
            }
            unchecked {
                ++i;
            }
        }

        if (count == 0) {
            return (false, bytes(""));
        }

        uint256[] memory result = new uint256[](count);
        for (uint256 i = 0; i < count;) {
            result[i] = settleable[i];
            unchecked {
                ++i;
            }
        }

        upkeepNeeded = true;
        performData = abi.encode(result);
    }

    /// @notice Settles the policy IDs returned by `checkUpkeep`.
    /// @param performData ABI-encoded array of candidate policy IDs.
    function performUpkeep(bytes calldata performData) external override {
        uint256[] memory policyIds = abi.decode(performData, (uint256[]));
        if (policyIds.length == 0) {
            return;
        }
        policyFactory.settlePolicies(policyIds);
    }
}
