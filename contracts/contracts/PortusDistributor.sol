// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPortusDistributor} from "./interfaces/IPortusDistributor.sol";
import {ReleaseMode} from "./interfaces/PortusTypes.sol";

/// @notice Radar incentives and treasury rewards, paid by Merkle claim.
///
/// Two kinds of pot, keyed (token, asset):
/// - incentive pot (asset == token): the launch's incentive allocation, funded
///   at finalize and released day by day — linearly (r·S per day) or decaying
///   (r·remaining per day), as fixed at creation;
/// - treasury pot (asset == quote asset): balances a REWARDS-mode treasury
///   hands over every 24h.
///
/// The off-chain calculator publishes one root per epoch per pot. A root can
/// never allocate more than the pot has released/received minus what earlier
/// roots allocated, every claim is bounded by its epoch total, and claims open
/// only after a 24h challenge period so anyone can recompute the published data
/// first. The publisher decides who gets what *within* those bounds — that is
/// the trust it holds, and why the data behind every root must be public.
contract PortusDistributor is IPortusDistributor, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CHALLENGE_PERIOD = 1 days;
    uint256 public constant DAY = 1 days;
    uint256 private constant BPS = 10_000;
    uint256 private constant WAD = 1e18;
    /// @dev Must equal PortusFactory.TOTAL_SUPPLY (the linear schedule releases r·S per day).
    uint256 public constant TOTAL_SUPPLY = 1e27;

    address public immutable factory;
    address public immutable rootPublisher;

    struct LaunchInfo {
        address sale;
        address treasury;
        uint8 releaseMode;
        uint16 releaseRateBps;
        uint128 incentiveTotal;
        uint64 incentiveStart;
    }

    struct Epoch {
        bytes32 root;
        uint128 total;
        uint128 claimed;
        uint64 claimableAt;
    }

    mapping(address token => LaunchInfo) public launchOf;
    /// @dev Treasury rewards received per (token, quote asset).
    mapping(address token => mapping(address asset => uint256)) public funded;
    mapping(address token => mapping(address asset => uint256)) public allocated;
    mapping(address token => mapping(address asset => Epoch[])) internal _epochs;
    mapping(bytes32 epochKey => mapping(address account => bool)) public claimed;
    /// @dev Balance held per asset on behalf of all pots, for funding checks.
    mapping(address asset => uint256) public held;
    mapping(address account => address) public referrerOf;

    constructor(address factory_, address rootPublisher_) {
        factory = factory_;
        rootPublisher = rootPublisher_;
    }

    // ─── funding ──────────────────────────────────────────────────────────────

    function registerLaunch(address token, address sale, address treasury, uint8 releaseMode, uint16 releaseRateBps)
        external
    {
        if (msg.sender != factory) revert NotFactory();
        launchOf[token] = LaunchInfo(sale, treasury, releaseMode, releaseRateBps, 0, 0);
        _saleToken[sale] = token;
        emit LaunchRegistered(token, sale, treasury, releaseMode, releaseRateBps);
    }

    /// @notice Called by a launch's Sale at finalize, right after transferring
    /// the incentive allocation. Starts the release clock.
    function notifyIncentive(uint256 amount) external {
        address token = _tokenOfSale(msg.sender);
        LaunchInfo storage l = launchOf[token];
        if (l.incentiveStart != 0) revert AlreadyFunded();
        _receive(token, amount);
        l.incentiveTotal = uint128(amount);
        l.incentiveStart = uint64(block.timestamp);
        emit IncentiveFunded(token, amount, uint64(block.timestamp));
    }

    /// @notice Called by a REWARDS-mode Treasury, or by a mint-mode Emission
    /// (asset == token), right after transferring `amount`.
    function fundTreasury(address token, address asset, uint256 amount) external {
        if (launchOf[token].treasury != msg.sender || msg.sender == address(0)) revert NotTreasury();
        _receive(asset, amount);
        funded[token][asset] += amount;
        emit TreasuryFunded(token, asset, amount);
    }

    function _receive(address asset, uint256 amount) private {
        uint256 total = held[asset] + amount;
        if (IERC20(asset).balanceOf(address(this)) < total) revert FundingMismatch();
        held[asset] = total;
    }

    mapping(address sale => address token) private _saleToken;

    function _tokenOfSale(address sale) private view returns (address token) {
        token = _saleToken[sale];
        if (token == address(0)) revert NotSale();
    }

    // ─── release schedule ─────────────────────────────────────────────────────

    /// @notice Incentive tokens released so far (whole days since finalize).
    function released(address token) public view returns (uint256) {
        LaunchInfo memory l = launchOf[token];
        if (l.incentiveStart == 0) return 0;
        uint256 days_ = (block.timestamp - l.incentiveStart) / DAY;
        if (days_ == 0) return 0;
        uint256 total = l.incentiveTotal;
        if (l.releaseMode == uint8(ReleaseMode.LINEAR)) {
            // E_d = r·S per day.
            return Math.min(total, (days_ * l.releaseRateBps * TOTAL_SUPPLY) / BPS);
        }
        // E_d = r·B_d: remaining after d days = total·(1−r)^d.
        uint256 keep = _powWad(((BPS - l.releaseRateBps) * WAD) / BPS, days_);
        return total - Math.mulDiv(total, keep, WAD);
    }

    function available(address token, address asset) public view returns (uint256) {
        // Token pot: released incentive plus anything the launch's funder handed
        // over in the token itself (a mint-mode Emission's daily mint).
        uint256 cap = asset == token ? released(token) + funded[token][asset] : funded[token][asset];
        uint256 used = allocated[token][asset];
        return cap > used ? cap - used : 0;
    }

    /// @dev x^n for x in WAD, by squaring.
    function _powWad(uint256 x, uint256 n) private pure returns (uint256 r) {
        r = WAD;
        while (n > 0) {
            if (n & 1 == 1) r = Math.mulDiv(r, x, WAD);
            x = Math.mulDiv(x, x, WAD);
            n >>= 1;
        }
    }

    // ─── roots and claims ─────────────────────────────────────────────────────

    function publishRoot(address token, address asset, bytes32 root, uint256 total, string calldata dataURI)
        external
        returns (uint256 epoch)
    {
        if (msg.sender != rootPublisher) revert NotPublisher();
        if (launchOf[token].sale == address(0)) revert UnknownLaunch();
        uint256 avail = available(token, asset);
        if (total > avail) revert ExceedsAvailable(avail, total);
        allocated[token][asset] += total;
        Epoch[] storage list = _epochs[token][asset];
        epoch = list.length;
        uint64 at = uint64(block.timestamp + CHALLENGE_PERIOD);
        list.push(Epoch(root, uint128(total), 0, at));
        emit RootPublished(token, asset, epoch, root, total, at, dataURI);
    }

    function claim(address token, address asset, uint256 epoch, uint256 amount, bytes32[] calldata proof) external {
        _claim(msg.sender, token, asset, epoch, amount, proof);
    }

    /// @notice Anyone may trigger; funds only ever go to `account`.
    function claimFor(
        address account,
        address token,
        address asset,
        uint256 epoch,
        uint256 amount,
        bytes32[] calldata proof
    ) external {
        _claim(account, token, asset, epoch, amount, proof);
    }

    function _claim(
        address account,
        address token,
        address asset,
        uint256 epoch,
        uint256 amount,
        bytes32[] calldata proof
    ) private nonReentrant {
        Epoch storage e = _epochs[token][asset][epoch];
        if (block.timestamp < e.claimableAt) revert NotClaimable(e.claimableAt);
        bytes32 key = keccak256(abi.encode(token, asset, epoch));
        if (claimed[key][account]) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, token, asset, epoch, amount))));
        if (!MerkleProof.verifyCalldata(proof, e.root, leaf)) revert InvalidProof();
        uint256 newClaimed = uint256(e.claimed) + amount;
        // A malformed root can never pay out more than it was allowed to allocate.
        if (newClaimed > e.total) revert EpochOverdrawn();
        e.claimed = uint128(newClaimed);
        claimed[key][account] = true;
        held[asset] -= amount;
        IERC20(asset).safeTransfer(account, amount);
        emit Claimed(token, asset, epoch, account, amount);
    }

    function epochCount(address token, address asset) external view returns (uint256) {
        return _epochs[token][asset].length;
    }

    function epochAt(address token, address asset, uint256 epoch) external view returns (Epoch memory) {
        return _epochs[token][asset][epoch];
    }

    // ─── single-level referral ────────────────────────────────────────────────

    /// @notice Bind your direct inviter, once. There is no second level: only
    /// the direct inviter can ever be rewarded, by the fees you generate.
    function bindReferrer(address referrer) external {
        if (referrer == address(0) || referrer == msg.sender) revert InvalidReferrer();
        if (referrerOf[msg.sender] != address(0)) revert ReferrerAlreadySet();
        referrerOf[msg.sender] = referrer;
        emit ReferrerBound(msg.sender, referrer);
    }
}
