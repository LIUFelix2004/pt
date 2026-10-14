// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPortusLocker} from "./interfaces/IPortusLocker.sol";

/// @notice Owner of record for every pool's LP shares.
///
/// Shares are booked inside the pool, and the pool has no transfer or remove
/// path, so the lock already holds at the pool layer. This contract makes the
/// owner explicit and auditable. It deliberately has no outbound function.
contract PortusLocker is IPortusLocker {
    address public immutable factory;

    mapping(address pool => address token) public tokenOfPool;
    mapping(address pool => uint256) public lockedShares;

    constructor() {
        factory = msg.sender;
    }

    function registerPool(address pool, address token) external {
        if (msg.sender != factory) revert NotFactory();
        tokenOfPool[pool] = token;
        emit PoolRegistered(pool, token);
    }

    function notifyLocked(uint256 shares) external {
        if (tokenOfPool[msg.sender] == address(0)) revert UnknownPool();
        if (lockedShares[msg.sender] != 0) revert AlreadyLocked();
        lockedShares[msg.sender] = shares;
        emit LiquidityLocked(msg.sender, shares);
    }
}
