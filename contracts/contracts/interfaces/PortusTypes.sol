// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice What happens when a sale ends below its raise target.
/// REFUND: everyone gets their full commitment back and the whole supply burns.
/// SHRINK: the launch proceeds at the same price with a proportionally smaller pool.
enum UnderfillRule {
    REFUND,
    SHRINK
}

/// @notice Sale lifecycle. PENDING / OPEN / AWAITING_FINALIZE derive from time;
/// SUCCEEDED / REFUNDING are written once by `finalize()`.
enum Phase {
    PENDING,
    OPEN,
    AWAITING_FINALIZE,
    SUCCEEDED,
    REFUNDING
}

/// @notice Settlement result. FILLED: C >= R. SHRUNK: price kept, size reduced.
enum Outcome {
    NONE,
    FILLED,
    SHRUNK,
    REFUNDED
}

/// @notice What a launch's Treasury does with its fee share. Locked at creation.
enum TreasuryMode {
    BUYBACK, // buy the launch token in its own pool and burn it
    REWARDS // hand each 24h balance to the Distributor for TWAB rewards
}

/// @notice How the incentive pool is released. Locked at creation.
enum ReleaseMode {
    LINEAR, // r·S per day until the pool is empty
    DECAYING // r·(remaining) per day
}

struct QuoteAssetConfig {
    bool registered; // decimals are pinned the first time an asset is registered
    bool allowed; // usable by new launches
    bool freezable; // issuer can freeze addresses (front-end risk notice only)
    uint8 decimals;
    uint128 minFdv; // in quote-asset base units
    uint128 maxFdv;
    address priceSource; // where this asset is priced from (recorded at listing; 0 = priced in ETH directly)
    uint128 minPoolLiquidity; // flywheel eligibility: minimum quote reserve of a pool
}

struct LaunchParams {
    string name; // 1..32 bytes
    string symbol; // 1..11 bytes
    address quoteAsset;
    uint256 raiseTarget; // R, quote-asset base units
    uint16 feeBps; // one of {100, 200, 300, 400, 500}
    uint16 creatorShareBps; // <= 4000, recorded for the FeeSplitter phase
    uint16 incentiveBps; // X <= INCENTIVE_MAX_BPS
    uint64 startTime;
    uint64 duration;
    bytes32 merkleRoot; // 0 = no whitelist
    uint64 publicOpenAt; // 0 = no public phase
    uint256 publicCap; // per-address cap in the public phase
    UnderfillRule underRule;
    uint16 minFillBps; // SHRINK only; 0 = no floor
    uint8 treasuryMode; // TreasuryMode ordinal
    bytes32 metadataHash; // hash of off-chain copy, may be 0
    address creatorRecipient; // receives the creator fee share; 0 = msg.sender
    uint8 releaseMode; // ReleaseMode ordinal
    uint16 releaseRateBps; // daily release rate r, in bps
}

struct Launch {
    address creator;
    address token;
    address sale;
    address pool;
    address treasury;
    address quoteAsset;
    uint64 createdAt;
}

/// @notice Immutable configuration handed to a PortusSale at construction.
struct SaleConfig {
    address token;
    address quoteAsset;
    address pool;
    address treasury;
    address distributor;
    address creator;
    uint256 raiseTarget;
    uint256 qSale;
    uint256 qLp;
    uint256 qInc;
    uint256 priceNum; // r
    uint256 priceDen; // s
    uint64 startTime;
    uint64 endTime;
    uint64 publicOpenAt;
    uint256 publicCap;
    bytes32 merkleRoot;
    UnderfillRule underRule;
    uint16 minFillBps;
}

// ─── mint mode ("RADR-style" launches) ───────────────────────────────────────

/// @notice Mint-mode trading tax, taken in the launch token on every pool trade.
/// Buy and sell each split into a burn and two recipients; large sells pay an
/// extra levy on the price impact above `dumpThresholdBps`.
struct MintTax {
    uint16 buyBurnBps;
    uint16 buyCommunityBps;
    uint16 buyFoundationBps;
    uint16 sellBurnBps;
    uint16 sellCommunityBps;
    uint16 sellTechBps;
    uint16 dumpThresholdBps; // 0 = no anti-dump levy
    uint16 dumpBurnShareBps; // share of the levy burned; the rest goes to `market`
    address community;
    address foundation;
    address tech;
    address market;
}

/// @notice Mint schedule: cumulative minted supply grows by `growthBps[i]` per
/// 30-day month for `months[i]` months, phase by phase, until `maxSupply`.
/// A phase with 0 months ends the list.
struct MintSchedule {
    uint16[4] months;
    uint16[4] growthBps;
}

struct MintLaunchParams {
    string name; // 1..32 bytes
    string symbol; // 1..11 bytes
    address quoteAsset;
    uint256 raiseTarget; // R: raised by the sale, all of it seeds the pool
    uint256 initialSupply; // minted at creation: half sold, half paired with R in the pool
    uint256 maxSupply; // cap on cumulative minting
    uint64 startTime;
    uint64 duration;
    bytes32 merkleRoot;
    uint64 publicOpenAt;
    uint256 publicCap;
    UnderfillRule underRule;
    uint16 minFillBps;
    bytes32 metadataHash;
    uint16 staticBps; // share of each day's mint paid by holding rank; the rest by referral power
    MintSchedule schedule;
    MintTax tax;
}
