// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Platform flywheel: 20% of every pool's fees, spent buying back the
/// top 10 launches by 7-day time-weighted market cap, ranked separately per
/// quote asset, with a minimum-liquidity threshold. Bought tokens are burned.
///
/// Ranking is permissionless: during a round anyone may nominate a pool; the
/// contract keeps the 10 highest 7-day TWAP market caps among nominees. After
/// the nomination window anyone can call `executeRound`.
interface IPortusFlywheel {
    event Checkpoint(address indexed pool, uint256 cumulative, uint32 timestamp);
    event RoundStarted(address indexed quoteAsset, uint256 indexed round, uint64 start);
    event Nominated(address indexed quoteAsset, uint256 indexed round, address indexed pool, uint256 marketCap);
    event Evicted(address indexed quoteAsset, uint256 indexed round, address indexed pool);
    event FlywheelBuyback(address indexed quoteAsset, address indexed pool, uint256 quoteSpent, uint256 tokensBurned);
    event BuybackSkipped(address indexed quoteAsset, address indexed pool, bytes reason);
    event RoundExecuted(address indexed quoteAsset, uint256 indexed round, uint256 spent);

    error UnknownPool();
    error CheckpointTooSoon();
    error RoundActive();
    error NoActiveRound();
    error NominationClosed();
    error NominationOpen();
    error NotEligible();
    error AlreadyNominated();
    error NotRanked();

    function factory() external view returns (address);
    function checkpoint(address pool) external;
    function twapMarketCap(address pool) external view returns (bool eligible, uint256 marketCap);
    function startRound(address quoteAsset) external;
    function nominate(address quoteAsset, address pool) external;
    function executeRound(address quoteAsset) external returns (uint256 spent);
    function rankedPools(address quoteAsset) external view returns (address[] memory pools, uint256[] memory caps);
}
