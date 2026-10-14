// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IFeeSink} from "./interfaces/IFeeSink.sol";

/// @notice Phase-1 placeholder that passively receives quote-asset fees, sale
/// dust and skimmed balances. Receipts are reconstructed from pool and sale
/// events (FeePaid, Finalized, DustSwept, Skimmed), not tracked here.
///
/// No withdrawal path: local and testnet only. The FeeSplitter phase replaces it.
contract FeeSink is IFeeSink {
    address public immutable factory;

    mapping(address pool => address token) public tokenOfPool;
    mapping(address pool => address quoteAsset) public quoteAssetOfPool;

    constructor() {
        factory = msg.sender;
    }

    function registerPool(address pool, address token, address quoteAsset) external {
        if (msg.sender != factory) revert NotFactory();
        tokenOfPool[pool] = token;
        quoteAssetOfPool[pool] = quoteAsset;
        emit PoolRegistered(pool, token, quoteAsset);
    }
}
