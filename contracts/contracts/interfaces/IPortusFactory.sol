// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LaunchParams, Launch, MintSchedule, MintTax} from "./PortusTypes.sol";

interface IPortusFactory {
    event QuoteAssetSet(
        address indexed asset, bool allowed, bool freezable, uint8 decimals, uint128 minFdv, uint128 maxFdv
    );
    /// @dev Split from LaunchRules to stay under the stack limit; indexers consume both.
    event LaunchCreated(
        uint256 indexed launchId,
        address indexed creator,
        address indexed token,
        address sale,
        address pool,
        address quoteAsset,
        uint256 raiseTarget,
        uint256 qSale,
        uint256 qLp,
        uint256 qInc,
        uint256 priceNum,
        uint256 priceDen
    );
    event LaunchRules(
        uint256 indexed launchId,
        uint16 feeBps,
        uint16 creatorShareBps,
        uint16 incentiveBps,
        uint64 startTime,
        uint64 endTime,
        uint64 publicOpenAt,
        uint256 publicCap,
        bytes32 merkleRoot,
        uint8 underRule,
        uint16 minFillBps,
        uint8 treasuryMode,
        bytes32 metadataHash
    );

    event QuoteAssetChecks(address indexed asset, address priceSource, uint128 minPoolLiquidity);
    event LaunchEconomics(
        uint256 indexed launchId,
        address treasury,
        address creatorRecipient,
        uint8 treasuryMode,
        uint8 releaseMode,
        uint16 releaseRateBps
    );

    /// @notice Mint-mode launch details; `LaunchCreated` and `LaunchRules` are emitted too.
    event MintLaunch(
        uint256 indexed launchId,
        address indexed token,
        address emission,
        uint256 initialSupply,
        uint256 maxSupply,
        uint16 staticBps,
        MintSchedule schedule
    );
    event MintTaxSet(uint256 indexed launchId, address indexed token, MintTax tax);

    error NotQuoteAdmin();
    error ZeroAddress();
    error UnsupportedDecimals();
    error InvalidFdvBounds();
    error QuoteAssetNotAllowed(address asset);
    error InvalidFeeTier(uint16 feeBps);
    error CreatorShareTooHigh();
    error IncentiveTooHigh();
    error InvalidRaiseTarget();
    error FdvOutOfBounds();
    error PriceNotGranular(uint256 r);
    error InvalidSchedule();
    error NoSubscriptionPath();
    error InvalidPublicPhase();
    error InvalidUnderfill();
    error InvalidMetadata();
    error InvalidTreasuryMode();
    error InvalidRelease();
    error InvalidSupply();
    error InvalidMintSchedule();
    error InvalidTax();

    function createLaunch(LaunchParams calldata p)
        external
        returns (uint256 launchId, address token, address sale, address pool);

    function launchCount() external view returns (uint256);
    function launchAt(uint256 launchId) external view returns (Launch memory);
    function launchOf(address token) external view returns (Launch memory);
    function previewPrice(uint256 raiseTarget, uint16 incentiveBps)
        external
        pure
        returns (uint256 qSale, uint256 qLp, uint256 qInc, uint256 r, uint256 s);

    function setQuoteAsset(
        address asset,
        bool allowed,
        bool freezable,
        uint128 minFdv,
        uint128 maxFdv,
        address priceSource,
        uint128 minPoolLiquidity
    ) external;
}
