// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPortusTreasury} from "./interfaces/IPortusTreasury.sol";
import {IPortusPool} from "./interfaces/IPortusPool.sol";
import {IPortusDistributor} from "./interfaces/IPortusDistributor.sol";
import {TreasuryMode} from "./interfaces/PortusTypes.sol";
import {PortusMath} from "./libraries/PortusMath.sol";

/// @notice One per launch. Receives the treasury fee share (plus settlement
/// dust) in the quote asset. Nobody — creator, platform or anyone else — can
/// withdraw from it; it can only do the one thing its creation-time mode says:
///
/// - BUYBACK: anyone may call `executeBuyback`. The purchase must clear a
///   30-minute TWAP guard (average price ≤ TWAP × 1.02), may spend at most 10%
///   of the balance, and is rate-limited to once an hour. Bought tokens burn.
/// - REWARDS: anyone may call `fundRewards` once per 24h to move the balance
///   into the Distributor, which pays holders by 24h TWAB via Merkle claims.
contract PortusTreasury is IPortusTreasury, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TWAP_WINDOW = 30 minutes;
    /// @dev An observation older than this may be refreshed by anyone, so a
    /// long-trending price cannot pin the TWAP far from spot forever. Refreshes
    /// are at most every 4h, leaving ≥ 3.5h of every cycle for buybacks.
    uint256 public constant MAX_OBSERVATION_AGE = 4 hours;
    uint256 public constant BUYBACK_COOLDOWN = 1 hours;
    uint256 public constant MAX_SPEND_BPS = 1_000;
    uint256 public constant MAX_PREMIUM_BPS = 200;
    uint256 public constant REWARD_EPOCH = 1 days;
    uint256 private constant BPS = 10_000;
    uint256 private constant Q112 = 2 ** 112;

    address public immutable factory;
    address public immutable token;
    address public immutable quoteAsset;
    address public immutable pool;
    address public immutable distributor;
    uint8 public immutable mode;

    uint256 public obsCumulative;
    uint32 public obsTime;
    uint64 public lastAction;

    constructor(address token_, address quoteAsset_, address pool_, address distributor_, uint8 mode_) {
        factory = msg.sender;
        token = token_;
        quoteAsset = quoteAsset_;
        pool = pool_;
        distributor = distributor_;
        mode = mode_;
    }

    /// @notice Record a TWAP observation: the first one once the pool is live,
    /// or a fresh one when the current observation is older than
    /// MAX_OBSERVATION_AGE. Nobody can reset a recent observation, so the
    /// window cannot be griefed; every successful buyback also rolls it forward.
    function startObservation() external {
        if (mode != uint8(TreasuryMode.BUYBACK)) revert WrongMode();
        if (obsTime != 0 && block.timestamp < uint256(obsTime) + MAX_OBSERVATION_AGE) revert AlreadyObserving();
        if (!IPortusPool(pool).initialized()) revert PoolNotLive();
        (uint256 cum, uint32 ts) = IPortusPool(pool).currentCumulativePrice();
        obsCumulative = cum;
        obsTime = ts;
        emit ObservationStarted(cum, ts);
    }

    function executeBuyback(uint256 maxQuoteIn, uint256 minTokensOut)
        external
        nonReentrant
        returns (uint256 tokensBurned)
    {
        if (mode != uint8(TreasuryMode.BUYBACK)) revert WrongMode();
        uint256 readyAt = uint256(lastAction) + BUYBACK_COOLDOWN;
        if (lastAction != 0 && block.timestamp < readyAt) revert CooldownActive(readyAt);
        if (obsTime == 0 || block.timestamp < uint256(obsTime) + TWAP_WINDOW) revert ObservationNotReady();

        (uint256 cum, uint32 ts) = IPortusPool(pool).currentCumulativePrice();
        uint256 twap;
        unchecked {
            twap = (cum - obsCumulative) / (ts - obsTime); // UQ112x112 quote per token
        }

        uint256 balance = IERC20(quoteAsset).balanceOf(address(this));
        uint256 quoteIn = Math.min(maxQuoteIn, (balance * MAX_SPEND_BPS) / BPS);
        if (quoteIn == 0 || twap == 0) revert NothingToSpend();

        // Average execution price must not exceed TWAP · (1 + 2%):
        //   net / out ≤ twap/2^112 · 1.02  ⇔  out ≥ net · 2^112 · B / (twap · (B + premium))
        uint256 net = quoteIn - PortusMath.mulDivUp(quoteIn, IPortusPool(pool).feeBps(), BPS);
        uint256 guard = Math.mulDiv(net * BPS, Q112, twap * (BPS + MAX_PREMIUM_BPS));
        uint256 minOut = Math.max(minTokensOut, guard);

        obsCumulative = cum;
        obsTime = ts;
        lastAction = uint64(block.timestamp);

        IERC20(quoteAsset).forceApprove(pool, quoteIn);
        tokensBurned = IPortusPool(pool).buy(quoteIn, minOut, address(this), block.timestamp);
        ERC20Burnable(token).burn(tokensBurned);
        emit Buyback(quoteIn, tokensBurned, twap);
    }

    function fundRewards() external nonReentrant returns (uint256 amount) {
        if (mode != uint8(TreasuryMode.REWARDS)) revert WrongMode();
        uint256 readyAt = uint256(lastAction) + REWARD_EPOCH;
        if (lastAction != 0 && block.timestamp < readyAt) revert CooldownActive(readyAt);
        amount = IERC20(quoteAsset).balanceOf(address(this));
        if (amount == 0) revert NothingToSpend();
        lastAction = uint64(block.timestamp);
        IERC20(quoteAsset).safeTransfer(distributor, amount);
        IPortusDistributor(distributor).fundTreasury(token, quoteAsset, amount);
        emit RewardsFunded(amount);
    }
}
