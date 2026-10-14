// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPortusDistributor} from "./interfaces/IPortusDistributor.sol";
import {Outcome, MintSchedule} from "./interfaces/PortusTypes.sol";
import {PortusMintToken} from "./PortusMintToken.sol";

interface ISaleView {
    function outcome() external view returns (Outcome);
    function endTime() external view returns (uint64);
}

/// @notice Mint-mode emission for one launch: the only minter of its token.
///
/// Cumulative minted supply follows a fixed schedule from the sale's end time:
/// month by month (30 days) it grows by the current phase's rate, linearly
/// within each month, capped at the token's maxSupply. Anyone may call
/// `mintDaily()`; it mints whatever the schedule allows up to the current whole
/// day and hands it to the Distributor, where the root publisher allocates it
/// by holding rank (`staticBps`) and referral power (the rest), bounded by what
/// has been minted, claimable after the Distributor's challenge period.
///
/// Nothing is minted unless the sale succeeded (FILLED or SHRUNK).
contract PortusEmission is ReentrancyGuard {
    uint256 public constant DAY = 1 days;
    uint256 public constant MONTH_DAYS = 30;
    uint256 private constant BPS = 10_000;

    address public immutable factory;
    PortusMintToken public immutable token;
    address public immutable distributor;
    uint256 public immutable initialSupply;
    uint256 public immutable maxSupply;
    uint16 public immutable staticBps;

    uint16[4] internal _months;
    uint16[4] internal _growthBps;

    address public sale;
    /// @notice Last whole day minted through (0 = nothing minted yet).
    uint256 public mintedThroughDay;

    event Minted(uint256 indexed day, uint256 amount, uint256 staticAmount, uint256 dynamicAmount, uint256 totalMinted);

    error NotFactory();
    error SaleAlreadyBound();
    error NotActive();
    error NothingToMint();

    constructor(
        address token_,
        address distributor_,
        uint256 initialSupply_,
        uint256 maxSupply_,
        uint16 staticBps_,
        MintSchedule memory schedule_
    ) {
        factory = msg.sender;
        token = PortusMintToken(token_);
        distributor = distributor_;
        initialSupply = initialSupply_;
        maxSupply = maxSupply_;
        staticBps = staticBps_;
        _months = schedule_.months;
        _growthBps = schedule_.growthBps;
    }

    function bindSale(address sale_) external {
        if (msg.sender != factory) revert NotFactory();
        if (sale != address(0)) revert SaleAlreadyBound();
        sale = sale_;
    }

    // ─── minting ──────────────────────────────────────────────────────────────

    function mintDaily() external nonReentrant returns (uint256 amount) {
        if (!active()) revert NotActive();
        uint256 day = currentDay();
        amount = mintable();
        if (amount == 0) revert NothingToMint();
        mintedThroughDay = day;
        token.mint(distributor, amount);
        IPortusDistributor(distributor).fundTreasury(address(token), address(token), amount);
        uint256 staticAmount = (amount * staticBps) / BPS;
        emit Minted(day, amount, staticAmount, amount - staticAmount, token.totalMinted());
    }

    // ─── views ────────────────────────────────────────────────────────────────

    function schedule() external view returns (uint16[4] memory months, uint16[4] memory growthBps) {
        return (_months, _growthBps);
    }

    /// @notice True once the sale settled with a pool (FILLED or SHRUNK).
    function active() public view returns (bool) {
        if (sale == address(0)) return false;
        Outcome o = ISaleView(sale).outcome();
        return o == Outcome.FILLED || o == Outcome.SHRUNK;
    }

    /// @notice Schedule origin: the sale's end time.
    function origin() public view returns (uint256) {
        return sale == address(0) ? 0 : ISaleView(sale).endTime();
    }

    /// @notice Whole days elapsed since the origin.
    function currentDay() public view returns (uint256) {
        uint256 o = origin();
        if (o == 0 || block.timestamp < o) return 0;
        return (block.timestamp - o) / DAY;
    }

    /// @notice What `mintDaily()` would mint now.
    function mintable() public view returns (uint256) {
        if (!active()) return 0;
        uint256 target = targetAtDay(currentDay());
        uint256 minted = token.totalMinted();
        return target > minted ? target - minted : 0;
    }

    /// @notice Cumulative minted supply the schedule allows after `day` whole days.
    function targetAtDay(uint256 day) public view returns (uint256) {
        uint256 m = day / MONTH_DAYS;
        uint256 a = targetAtMonth(m);
        if (a >= maxSupply) return maxSupply;
        uint256 b = targetAtMonth(m + 1);
        return Math.min(maxSupply, a + ((b - a) * (day % MONTH_DAYS)) / MONTH_DAYS);
    }

    /// @notice Cumulative target after `m` whole months: initial supply grown by
    /// each phase's monthly rate, compounding, capped at maxSupply. Constant after
    /// the last phase.
    function targetAtMonth(uint256 m) public view returns (uint256 v) {
        v = initialSupply;
        uint256 cap = maxSupply;
        for (uint256 i = 0; i < 4 && m > 0; i++) {
            uint256 n = _months[i];
            if (n == 0) break;
            if (n > m) n = m;
            uint256 g = BPS + _growthBps[i];
            for (uint256 k = 0; k < n; k++) {
                v = (v * g) / BPS;
                if (v >= cap) return cap;
            }
            m -= n;
        }
    }
}
