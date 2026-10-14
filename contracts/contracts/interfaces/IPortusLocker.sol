// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Explicit, auditable owner of record for every pool's LP shares.
/// It has no outbound path of any kind: no transfer, no withdraw, no execute.
interface IPortusLocker {
    event PoolRegistered(address indexed pool, address indexed token);
    event LiquidityLocked(address indexed pool, uint256 shares);

    error NotFactory();
    error UnknownPool();
    error AlreadyLocked();

    function factory() external view returns (address);
    function tokenOfPool(address pool) external view returns (address);
    function lockedShares(address pool) external view returns (uint256);

    function registerPool(address pool, address token) external;
    function notifyLocked(uint256 shares) external;
}
