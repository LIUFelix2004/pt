// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Passive receiver for quote-asset fees, settlement dust and skimmed
/// balances. Phase 1 has no withdrawal path, so it is local/testnet only.
///
/// TODO(FeeSplitter): add `onFee(address token, address quoteAsset, uint256 amount)`
/// and split in real time by the ratios locked at launch creation.
interface IFeeSink {
    event PoolRegistered(address indexed pool, address indexed token, address indexed quoteAsset);

    error NotFactory();

    function factory() external view returns (address);
    function tokenOfPool(address pool) external view returns (address);
    function quoteAssetOfPool(address pool) external view returns (address);

    function registerPool(address pool, address token, address quoteAsset) external;
}
