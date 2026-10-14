// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPortusFlywheel} from "./interfaces/IPortusFlywheel.sol";
import {IPortusPool} from "./interfaces/IPortusPool.sol";
import {IPortusFeeSplitter} from "./interfaces/IPortusFeeSplitter.sol";
import {PortusMath} from "./libraries/PortusMath.sol";

interface IFactoryView {
    function isPool(address pool) external view returns (bool);
    function feeSplitter() external view returns (address);
    function quoteAssets(address asset)
        external
        view
        returns (
            bool registered,
            bool allowed,
            bool freezable,
            uint8 decimals,
            uint128 minFdv,
            uint128 maxFdv,
            address priceSource,
            uint128 minPoolLiquidity
        );
}

/// @notice Platform flywheel. Receives 20% of every Portus pool's fees (booked
/// by the FeeSplitter per quote asset) and spends them buying back the top 10
/// launches *in that same quote asset*, ranked by 7-day time-weighted market
/// cap with a minimum-liquidity threshold. Everything bought is burned.
///
/// Anti-manipulation:
/// - ranking uses a 7-day TWAP built from daily checkpoints anyone can record,
///   so a short pump in a thin pool cannot buy its way into the top 10;
/// - pools below the asset's minimum quote reserve are not eligible;
/// - each buy spends at most 1% of the pool's quote reserve and must clear a
///   price guard (average price ≤ short TWAP × 1.05), else it is skipped.
///
/// Ranking is permissionless and bounded in gas: during a round's nomination
/// window anyone may nominate a pool; the contract keeps the 10 highest.
contract PortusFlywheel is IPortusFlywheel, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CHECKPOINT_INTERVAL = 1 days;
    uint256 public constant TWAP_PERIOD = 7 days;
    uint256 public constant SHORT_TWAP_MIN = 1 hours;
    uint256 public constant ROUND_INTERVAL = 1 days;
    uint256 public constant NOMINATION_WINDOW = 12 hours;
    uint256 public constant TOP_N = 10;
    uint256 public constant MAX_POOL_SPEND_BPS = 100;
    uint256 public constant MAX_PREMIUM_BPS = 500;
    uint256 private constant RING = 9;
    uint256 private constant BPS = 10_000;
    uint256 private constant Q112 = 2 ** 112;

    address public immutable factory;

    struct Obs {
        uint256 cumulative;
        uint32 timestamp;
    }

    struct Round {
        uint64 start;
        bool active;
        uint8 count;
        uint256 id;
        address[TOP_N] pools;
        uint256[TOP_N] caps;
    }

    mapping(address pool => Obs[RING]) internal _ring;
    mapping(address pool => uint256) public checkpointCount;
    mapping(address quoteAsset => Round) internal _rounds;

    constructor(address factory_) {
        factory = factory_;
    }

    // ─── checkpoints ──────────────────────────────────────────────────────────

    function checkpoint(address pool) external {
        if (!IFactoryView(factory).isPool(pool)) revert UnknownPool();
        uint256 n = checkpointCount[pool];
        if (n > 0 && block.timestamp < uint256(_ring[pool][(n - 1) % RING].timestamp) + CHECKPOINT_INTERVAL) {
            revert CheckpointTooSoon();
        }
        (uint256 cum, uint32 ts) = IPortusPool(pool).currentCumulativePrice();
        _ring[pool][n % RING] = Obs(cum, ts);
        checkpointCount[pool] = n + 1;
        emit Checkpoint(pool, cum, ts);
    }

    /// @dev Newest checkpoint at least `minAge` old, if any.
    function _obsOlderThan(address pool, uint256 minAge) private view returns (bool found, Obs memory o) {
        uint256 n = checkpointCount[pool];
        uint256 k = n < RING ? n : RING;
        for (uint256 i = 0; i < k; i++) {
            Obs memory c = _ring[pool][(n - 1 - i) % RING];
            if (block.timestamp >= uint256(c.timestamp) + minAge) return (true, c);
        }
    }

    function _twap(address pool, uint256 minAge) private view returns (uint256 priceQ112) {
        (bool found, Obs memory o) = _obsOlderThan(pool, minAge);
        if (!found) return 0;
        (uint256 cum, uint32 ts) = IPortusPool(pool).currentCumulativePrice();
        if (ts == o.timestamp) return 0;
        unchecked {
            priceQ112 = (cum - o.cumulative) / (ts - o.timestamp);
        }
    }

    function twapMarketCap(address pool) public view returns (bool eligible, uint256 marketCap) {
        if (!IFactoryView(factory).isPool(pool)) return (false, 0);
        uint256 price = _twap(pool, TWAP_PERIOD);
        if (price == 0) return (false, 0);
        (,,,,,,, uint128 minLiq) = IFactoryView(factory).quoteAssets(IPortusPool(pool).quoteAsset());
        (uint112 q,,) = IPortusPool(pool).getReserves();
        if (q < minLiq) return (false, 0);
        marketCap = Math.mulDiv(price, IERC20(IPortusPool(pool).token()).totalSupply(), Q112);
        eligible = marketCap > 0;
    }

    // ─── rounds ───────────────────────────────────────────────────────────────

    function startRound(address quoteAsset) external {
        Round storage r = _rounds[quoteAsset];
        if (r.active || (r.start != 0 && block.timestamp < uint256(r.start) + ROUND_INTERVAL)) revert RoundActive();
        r.active = true;
        r.start = uint64(block.timestamp);
        r.count = 0;
        r.id += 1;
        emit RoundStarted(quoteAsset, r.id, r.start);
    }

    function nominate(address quoteAsset, address pool) external {
        Round storage r = _rounds[quoteAsset];
        if (!r.active) revert NoActiveRound();
        if (block.timestamp >= uint256(r.start) + NOMINATION_WINDOW) revert NominationClosed();
        if (!IFactoryView(factory).isPool(pool) || IPortusPool(pool).quoteAsset() != quoteAsset) revert UnknownPool();
        uint256 count = r.count;
        for (uint256 i = 0; i < count; i++) {
            if (r.pools[i] == pool) revert AlreadyNominated();
        }
        (bool eligible, uint256 cap) = twapMarketCap(pool);
        if (!eligible) revert NotEligible();

        if (count < TOP_N) {
            r.pools[count] = pool;
            r.caps[count] = cap;
            r.count = uint8(count + 1);
        } else {
            uint256 minIdx;
            for (uint256 i = 1; i < TOP_N; i++) {
                if (r.caps[i] < r.caps[minIdx]) minIdx = i;
            }
            if (cap <= r.caps[minIdx]) revert NotRanked();
            emit Evicted(quoteAsset, r.id, r.pools[minIdx]);
            r.pools[minIdx] = pool;
            r.caps[minIdx] = cap;
        }
        emit Nominated(quoteAsset, r.id, pool, cap);
    }

    function executeRound(address quoteAsset) external nonReentrant returns (uint256 spent) {
        Round storage r = _rounds[quoteAsset];
        if (!r.active) revert NoActiveRound();
        if (block.timestamp < uint256(r.start) + NOMINATION_WINDOW) revert NominationOpen();
        r.active = false;

        IPortusFeeSplitter splitter = IPortusFeeSplitter(IFactoryView(factory).feeSplitter());
        if (splitter.owed(quoteAsset, address(this)) > 0) splitter.claim(quoteAsset);

        uint256 count = r.count;
        if (count > 0) {
            uint256 per = IERC20(quoteAsset).balanceOf(address(this)) / count;
            for (uint256 i = 0; i < count; i++) {
                spent += _buy(quoteAsset, r.pools[i], per);
            }
        }
        emit RoundExecuted(quoteAsset, r.id, spent);
    }

    function _buy(address quoteAsset, address pool, uint256 budget) private returns (uint256 spent) {
        (uint112 reserveQ,,) = IPortusPool(pool).getReserves();
        uint256 amount = Math.min(budget, (uint256(reserveQ) * MAX_POOL_SPEND_BPS) / BPS);
        uint256 twap = _twap(pool, SHORT_TWAP_MIN);
        if (amount == 0 || twap == 0) {
            emit BuybackSkipped(quoteAsset, pool, "");
            return 0;
        }
        uint256 net = amount - PortusMath.mulDivUp(amount, IPortusPool(pool).feeBps(), BPS);
        uint256 minOut = Math.mulDiv(net * BPS, Q112, twap * (BPS + MAX_PREMIUM_BPS));
        if (minOut == 0) minOut = 1;

        IERC20(quoteAsset).forceApprove(pool, amount);
        try IPortusPool(pool).buy(amount, minOut, address(this), block.timestamp) returns (uint256 out) {
            ERC20Burnable(IPortusPool(pool).token()).burn(out);
            emit FlywheelBuyback(quoteAsset, pool, amount, out);
            spent = amount;
        } catch (bytes memory reason) {
            IERC20(quoteAsset).forceApprove(pool, 0);
            emit BuybackSkipped(quoteAsset, pool, reason);
        }
    }

    // ─── views ────────────────────────────────────────────────────────────────

    function rankedPools(address quoteAsset) external view returns (address[] memory pools, uint256[] memory caps) {
        Round storage r = _rounds[quoteAsset];
        pools = new address[](r.count);
        caps = new uint256[](r.count);
        for (uint256 i = 0; i < r.count; i++) {
            pools[i] = r.pools[i];
            caps[i] = r.caps[i];
        }
    }

    function roundOf(address quoteAsset) external view returns (uint256 id, uint64 start, bool active, uint8 count) {
        Round storage r = _rounds[quoteAsset];
        return (r.id, r.start, r.active, r.count);
    }
}
