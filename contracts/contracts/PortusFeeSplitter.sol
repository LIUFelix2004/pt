// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPortusFeeSplitter} from "./interfaces/IPortusFeeSplitter.sol";

/// @notice Platform-wide fee splitter. One contract, per-pool ratios that are
/// written once at creation and can never be changed by anyone.
///
/// On every fee the pool transfers quote asset here and calls `onFee`. The
/// treasury share goes straight to that launch's Treasury; ecosystem, flywheel
/// and creator shares are booked and pulled by their recipients (`claim`).
/// Rounding dust always lands in the treasury share.
contract PortusFeeSplitter is IPortusFeeSplitter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant ECOSYSTEM_BPS = 2_000;
    uint16 public constant FLYWHEEL_BPS = 2_000;
    uint256 private constant BPS = 10_000;

    address public immutable factory;
    address public immutable ecosystem;
    address public immutable flywheel;

    struct PoolShares {
        address token;
        address quoteAsset;
        address creator;
        address treasury;
        uint16 creatorBps;
    }

    mapping(address pool => PoolShares) public sharesOfPool;
    mapping(address token => address pool) public poolOfToken;
    /// @dev Quote balance held here on behalf of booked (unclaimed) shares.
    mapping(address quoteAsset => uint256) public accounted;
    mapping(address quoteAsset => mapping(address account => uint256)) public owed;

    constructor(address factory_, address ecosystem_, address flywheel_) {
        factory = factory_;
        ecosystem = ecosystem_;
        flywheel = flywheel_;
    }

    function registerPool(
        address pool,
        address token,
        address quoteAsset,
        address creator,
        uint16 creatorBps,
        address treasury
    ) external {
        if (msg.sender != factory) revert NotFactory();
        sharesOfPool[pool] = PoolShares(token, quoteAsset, creator, treasury, creatorBps);
        poolOfToken[token] = pool;
        emit PoolRegistered(pool, token, quoteAsset, creator, creatorBps, treasury);
    }

    /// @notice Called by a registered pool right after transferring `amount` here.
    function onFee(uint256 amount) external nonReentrant {
        PoolShares memory s = sharesOfPool[msg.sender];
        if (s.token == address(0)) revert UnknownPool();
        if (amount == 0) return;
        address q = s.quoteAsset;
        uint256 held = accounted[q];
        if (IERC20(q).balanceOf(address(this)) < held + amount) revert FeeNotReceived();

        uint256 eco = (amount * ECOSYSTEM_BPS) / BPS;
        uint256 fw = (amount * FLYWHEEL_BPS) / BPS;
        uint256 cr = (amount * s.creatorBps) / BPS;
        uint256 tr = amount - eco - fw - cr;

        owed[q][ecosystem] += eco;
        owed[q][flywheel] += fw;
        if (cr > 0) owed[q][s.creator] += cr;
        accounted[q] = held + eco + fw + cr;

        if (tr > 0) IERC20(q).safeTransfer(s.treasury, tr);
        emit FeeSplit(s.token, q, eco, fw, cr, tr);
    }

    function claim(address quoteAsset) external returns (uint256 amount) {
        return _claim(msg.sender, quoteAsset);
    }

    /// @notice Anyone may trigger; funds only ever go to `account`.
    function claimFor(address account, address quoteAsset) external returns (uint256 amount) {
        return _claim(account, quoteAsset);
    }

    function _claim(address account, address quoteAsset) private nonReentrant returns (uint256 amount) {
        amount = owed[quoteAsset][account];
        if (amount == 0) revert NothingToClaim();
        owed[quoteAsset][account] = 0;
        accounted[quoteAsset] -= amount;
        IERC20(quoteAsset).safeTransfer(account, amount);
        emit FeeClaimed(account, quoteAsset, amount, account);
    }

    function shares(address token)
        external
        view
        returns (uint16 ecosystemBps, uint16 flywheelBps, uint16 creatorBps, uint16 treasuryBps)
    {
        PoolShares memory s = sharesOfPool[poolOfToken[token]];
        if (s.token == address(0)) return (0, 0, 0, 0);
        return (ECOSYSTEM_BPS, FLYWHEEL_BPS, s.creatorBps, uint16(BPS - ECOSYSTEM_BPS - FLYWHEEL_BPS - s.creatorBps));
    }
}
