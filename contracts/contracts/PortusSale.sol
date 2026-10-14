// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPortusSale} from "./interfaces/IPortusSale.sol";
import {IPortusPool} from "./interfaces/IPortusPool.sol";
import {IPortusDistributor} from "./interfaces/IPortusDistributor.sol";
import {Phase, Outcome, UnderfillRule, SaleConfig} from "./interfaces/PortusTypes.sol";

/// @notice Fixed-price subscription for one launch.
///
/// Price p = R / qSale = r / s (reduced). Subscribers commit quote asset during
/// the window; `finalize()` then, in one transaction, funds the pool at exactly
/// p, initialises it, funds the incentive pool (Distributor) and burns everything unused.
///
/// Raised funds have exactly two destinations: the pool, or back to the
/// subscribers. Rounding dust goes to the launch Treasury. There is no creator
/// withdrawal, no forfeiture and no deadline after which claims expire.
contract PortusSale is IPortusSale, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    /// @dev Keeps c_i * qSale (qSale <= 1e27) far inside uint256.
    uint256 private constant MAX_TOTAL_COMMIT = 2 ** 160;

    address public immutable factory;
    address public immutable token;
    address public immutable quoteAsset;
    address public immutable pool;
    address public immutable treasury;
    address public immutable distributor;
    address public immutable creator;
    uint256 public immutable raiseTarget;
    uint256 public immutable qSale;
    uint256 public immutable qLp;
    uint256 public immutable qInc;
    uint256 public immutable priceNum;
    uint256 public immutable priceDen;
    uint64 public immutable startTime;
    uint64 public immutable endTime;
    uint64 public immutable publicOpenAt;
    uint256 public immutable publicCap;
    bytes32 public immutable merkleRoot;
    UnderfillRule public immutable underRule;
    uint16 public immutable minFillBps;

    uint256 public totalCommitted;
    uint256 public subscriberCount;
    uint256 public claimedCount;
    mapping(address => uint256) public committed;
    mapping(address => uint256) public whitelistCommitted;
    mapping(address => uint256) public publicCommitted;
    mapping(address => bool) public claimed;

    Outcome public outcome;
    uint256 public poolQuote;
    uint256 public poolTokens;
    uint256 public tokensForClaims;
    uint256 public quoteForRefunds;
    uint256 public incentiveFunded;
    uint256 public tokensBurned;
    uint256 public quoteDust;
    bool public dustSwept;

    /// @dev Projected or final settlement figures. One code path computes both,
    /// so previewSettlement() can never disagree with finalize().
    struct Settlement {
        Outcome outcome;
        uint256 poolQuote;
        uint256 poolTokens;
        uint256 tokensForClaims;
        uint256 quoteForRefunds;
        uint256 incentive;
        uint256 burn;
        uint256 quoteDust;
    }

    constructor(SaleConfig memory c) {
        factory = msg.sender;
        token = c.token;
        quoteAsset = c.quoteAsset;
        pool = c.pool;
        treasury = c.treasury;
        distributor = c.distributor;
        creator = c.creator;
        raiseTarget = c.raiseTarget;
        qSale = c.qSale;
        qLp = c.qLp;
        qInc = c.qInc;
        priceNum = c.priceNum;
        priceDen = c.priceDen;
        startTime = c.startTime;
        endTime = c.endTime;
        publicOpenAt = c.publicOpenAt;
        publicCap = c.publicCap;
        merkleRoot = c.merkleRoot;
        underRule = c.underRule;
        minFillBps = c.minFillBps;
    }

    // ─── subscription ─────────────────────────────────────────────────────────

    function subscribe(uint256 amount, uint256 cap, bytes32[] calldata proof) external nonReentrant {
        if (phase() != Phase.OPEN) revert NotOpen();
        if (amount == 0) revert ZeroAmount();
        // OZ-recommended double hash, which rules out second-preimage leaves.
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, cap))));
        if (merkleRoot == bytes32(0) || !MerkleProof.verifyCalldata(proof, merkleRoot, leaf)) revert InvalidProof();
        uint256 wouldBe = whitelistCommitted[msg.sender] + amount;
        if (wouldBe > cap) revert CapExceeded(cap, wouldBe);
        whitelistCommitted[msg.sender] = wouldBe;
        _commit(amount, true);
    }

    function subscribePublic(uint256 amount) external nonReentrant {
        if (phase() != Phase.OPEN) revert NotOpen();
        if (publicOpenAt == 0 || block.timestamp < publicOpenAt) revert PublicNotOpen();
        if (amount == 0) revert ZeroAmount();
        uint256 wouldBe = publicCommitted[msg.sender] + amount;
        if (wouldBe > publicCap) revert CapExceeded(publicCap, wouldBe);
        publicCommitted[msg.sender] = wouldBe;
        _commit(amount, false);
    }

    /// @dev Commitments cannot be withdrawn before the end (Portus rule, N5).
    function _commit(uint256 amount, bool viaWhitelist) private {
        uint256 before = IERC20(quoteAsset).balanceOf(address(this));
        IERC20(quoteAsset).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(quoteAsset).balanceOf(address(this)) - before != amount) revert UnsupportedQuoteToken();

        uint256 mine = committed[msg.sender];
        if (mine == 0) subscriberCount++;
        mine += amount;
        committed[msg.sender] = mine;
        uint256 total = totalCommitted + amount;
        if (total > MAX_TOTAL_COMMIT) revert TotalCommitTooLarge();
        totalCommitted = total;

        emit Subscribed(msg.sender, amount, mine, total, viaWhitelist);
    }

    // ─── settlement ───────────────────────────────────────────────────────────

    /// @notice Anyone may call once the window has closed. Funds the pool,
    /// opens it at the subscription price and burns what is not needed, all in
    /// one transaction, so nobody can trade between settlement and opening.
    function finalize() external nonReentrant {
        if (phase() != Phase.AWAITING_FINALIZE) revert NotAwaitingFinalize();
        Settlement memory s = _settlement(totalCommitted);

        outcome = s.outcome;
        poolQuote = s.poolQuote;
        poolTokens = s.poolTokens;
        tokensForClaims = s.tokensForClaims;
        quoteForRefunds = s.quoteForRefunds;
        incentiveFunded = s.incentive;
        tokensBurned = s.burn;
        quoteDust = s.quoteDust;

        if (s.poolQuote > 0) {
            IERC20(quoteAsset).safeTransfer(pool, s.poolQuote);
            IERC20(token).safeTransfer(pool, s.poolTokens);
            IPortusPool(pool).initialize(s.poolQuote, s.poolTokens);
        }
        if (s.incentive > 0) {
            IERC20(token).safeTransfer(distributor, s.incentive);
            IPortusDistributor(distributor).notifyIncentive(s.incentive);
        }
        if (s.quoteDust > 0) IERC20(quoteAsset).safeTransfer(treasury, s.quoteDust);
        if (s.burn > 0) ERC20Burnable(token).burn(s.burn);

        emit Finalized(
            uint8(s.outcome),
            totalCommitted,
            s.poolQuote,
            s.poolTokens,
            s.tokensForClaims,
            s.quoteForRefunds,
            s.incentive,
            s.burn,
            s.quoteDust
        );
    }

    function claim() external returns (uint256 tokens, uint256 refund) {
        return _claim(msg.sender);
    }

    /// @notice Anyone may trigger a claim; assets only ever go to `account`.
    function claimFor(address account) external returns (uint256 tokens, uint256 refund) {
        return _claim(account);
    }

    function _claim(address account) private nonReentrant returns (uint256 tokens, uint256 refund) {
        Outcome o = outcome;
        if (o == Outcome.NONE) revert NotSettled();
        uint256 c = committed[account];
        if (c == 0) revert NothingToClaim();
        if (claimed[account]) revert AlreadyClaimed();

        (tokens, refund) = _entitlement(o, c);
        claimed[account] = true;
        claimedCount++;

        if (tokens > 0) IERC20(token).safeTransfer(account, tokens);
        if (refund > 0) IERC20(quoteAsset).safeTransfer(account, refund);
        emit Claimed(account, tokens, refund, msg.sender);
    }

    /// @notice After every subscriber has claimed, burn leftover tokens and send
    /// leftover quote (rounding dust plus any stray transfers) to the Treasury.
    /// Gated on all claims, so dust can never eat into an unclaimed share.
    function sweepDust() external nonReentrant {
        Outcome o = outcome;
        if (o != Outcome.FILLED && o != Outcome.SHRUNK) revert NotSettled();
        if (claimedCount != subscriberCount) revert ClaimsOutstanding();
        if (dustSwept) revert AlreadySwept();
        dustSwept = true;

        uint256 tokenLeft = IERC20(token).balanceOf(address(this));
        uint256 quoteLeft = IERC20(quoteAsset).balanceOf(address(this));
        if (tokenLeft > 0) ERC20Burnable(token).burn(tokenLeft);
        if (quoteLeft > 0) IERC20(quoteAsset).safeTransfer(treasury, quoteLeft);
        emit DustSwept(tokenLeft, quoteLeft);
    }

    // ─── views ────────────────────────────────────────────────────────────────

    function phase() public view returns (Phase) {
        Outcome o = outcome;
        if (o == Outcome.REFUNDED) return Phase.REFUNDING;
        if (o != Outcome.NONE) return Phase.SUCCEEDED;
        if (block.timestamp < startTime) return Phase.PENDING;
        if (block.timestamp < endTime) return Phase.OPEN;
        return Phase.AWAITING_FINALIZE;
    }

    /// @notice Final entitlement after settlement; before it, what `account`
    /// would receive if the sale settled on the current total.
    function previewClaim(address account) external view returns (uint256 tokens, uint256 refund) {
        uint256 c = committed[account];
        if (c == 0 || claimed[account]) return (0, 0);
        Outcome o = outcome;
        if (o == Outcome.NONE) {
            o = _settlement(totalCommitted).outcome;
        }
        return _entitlement(o, c);
    }

    function previewSettlement()
        external
        view
        returns (
            Outcome o,
            uint256 poolQuote_,
            uint256 poolTokens_,
            uint256 burn_,
            uint256 toVault_,
            uint256 quoteDust_
        )
    {
        if (outcome != Outcome.NONE) {
            return (outcome, poolQuote, poolTokens, tokensBurned, incentiveFunded, quoteDust);
        }
        Settlement memory s = _settlement(totalCommitted);
        return (s.outcome, s.poolQuote, s.poolTokens, s.burn, s.incentive, s.quoteDust);
    }

    // ─── settlement math (see docs/portus-spec.md §3) ────────────────────────

    function _settlement(uint256 c) private view returns (Settlement memory s) {
        uint256 supply = qSale + qLp + qInc;
        uint256 r = priceNum;
        uint256 k = c / r;

        if (c >= raiseTarget) {
            // FILLED: pool (R, qLp) has price R/qLp = R/qSale = p exactly.
            s.outcome = Outcome.FILLED;
            s.poolQuote = raiseTarget;
            s.poolTokens = qLp;
            s.tokensForClaims = qSale;
            s.quoteForRefunds = c - raiseTarget;
            s.incentive = qInc;
        } else if (underRule == UnderfillRule.SHRINK && c * BPS >= raiseTarget * minFillBps && k >= 1) {
            // SHRUNK: pool (k·r, k·s) keeps price r/s exactly; c - k·r < r is dust.
            s.outcome = Outcome.SHRUNK;
            s.poolQuote = k * r;
            s.poolTokens = k * priceDen;
            s.quoteDust = c - s.poolQuote;
            s.tokensForClaims = Math.mulDiv(c, priceDen, r);
            // Per the Portus docs only the unused sale and LP sides burn,
            // Q_burn = (1 − f)(1 − x)S; the incentive pool is kept whole.
            s.incentive = qInc;
            s.burn = (qSale - s.tokensForClaims) + (qLp - s.poolTokens);
        } else {
            // REFUNDED: everyone gets c_i back; the entire supply burns.
            s.outcome = Outcome.REFUNDED;
            s.quoteForRefunds = c;
            s.burn = supply;
        }
    }

    function _entitlement(Outcome o, uint256 c) private view returns (uint256 tokens, uint256 refund) {
        uint256 total = totalCommitted;
        if (o == Outcome.FILLED) {
            tokens = Math.mulDiv(c, qSale, total);
            refund = Math.mulDiv(c, total - raiseTarget, total);
        } else if (o == Outcome.SHRUNK) {
            tokens = Math.mulDiv(c, priceDen, priceNum);
        } else if (o == Outcome.REFUNDED) {
            refund = c;
        }
    }
}
