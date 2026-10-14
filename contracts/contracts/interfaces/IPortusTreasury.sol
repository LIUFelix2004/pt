// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Per-launch treasury. Receives the treasury fee share and can only
/// (a) buy back and burn the launch token, or (b) hand its balance to the
/// Distributor for TWAB rewards — whichever mode was locked at creation.
interface IPortusTreasury {
    event ObservationStarted(uint256 cumulative, uint32 timestamp);
    event Buyback(uint256 quoteSpent, uint256 tokensBurned, uint256 twapQ112);
    event RewardsFunded(uint256 amount);

    error WrongMode();
    error CooldownActive(uint256 readyAt);
    error ObservationNotReady();
    error AlreadyObserving();
    error NothingToSpend();
    error PoolNotLive();

    function token() external view returns (address);
    function quoteAsset() external view returns (address);
    function pool() external view returns (address);
    function distributor() external view returns (address);
    function mode() external view returns (uint8);

    function startObservation() external;
    function executeBuyback(uint256 maxQuoteIn, uint256 minTokensOut) external returns (uint256 tokensBurned);
    function fundRewards() external returns (uint256 amount);
}
