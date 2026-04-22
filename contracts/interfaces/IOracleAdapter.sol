// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IOracleAdapter {
    struct OracleResponse {
        uint256 price;
        uint256 updatedAt;
        bool isValid;
        bool usedFallback;
        bytes32 sourceTag;
    }

    function getPrice(bytes32 symbol) external view returns (OracleResponse memory response);
}
