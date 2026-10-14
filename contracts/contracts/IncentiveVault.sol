// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IIncentiveVault} from "./interfaces/IIncentiveVault.sol";

/// @notice Phase-1 placeholder for the incentive pool.
///
/// Tokens only come in. With no withdrawal path, anything funded here is locked
/// for good, which is why phase-1 factories must never reach a mainnet. The
/// Distributor phase replaces this with daily release + Merkle claims.
contract IncentiveVault is IIncentiveVault {
    address public immutable factory;

    mapping(address sale => address token) public tokenOfSale;
    mapping(address token => uint256) public funded;

    constructor() {
        factory = msg.sender;
    }

    function registerSale(address sale, address token) external {
        if (msg.sender != factory) revert NotFactory();
        tokenOfSale[sale] = token;
        emit SaleRegistered(sale, token);
    }

    /// @dev Called by the sale right after it transfers. Every launch token is
    /// unique to one sale, so the running total is a per-sale ledger.
    function notifyFunded(uint256 amount) external {
        address token = tokenOfSale[msg.sender];
        if (token == address(0)) revert UnknownSale();
        uint256 total = funded[token] + amount;
        if (IERC20(token).balanceOf(address(this)) < total) revert FundingMismatch();
        funded[token] = total;
        emit IncentiveFunded(token, amount);
    }
}
