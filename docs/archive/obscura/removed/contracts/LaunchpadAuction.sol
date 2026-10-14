// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AgentRegistry} from "./AgentRegistry.sol";

/**
 * @title LaunchpadAuction
 * @notice Sealed-bid, uniform-price batch auction.
 *
 * ## Why a batch auction and not first-come-first-served
 *
 * Minting is driven from the user's own AI agent. Agent latency is inherently
 * variable: LLM inference plus MCP round-trips is seconds to tens of seconds.
 * Under a first-come-first-served mint that is fatal, because a plain script
 * always wins the gas race and the "use your own agent" product rule collapses
 * on day one.
 *
 * A batch auction removes time from the competition entirely. Every bid inside
 * the commit window is equivalent regardless of when it lands, everyone pays
 * one uniform clearing price, and there is nothing for a searcher to front-run
 * because bids stay sealed until the window closes.
 *
 * ## Clearing price: optimistic submit, on-chain verify
 *
 * Sorting bids on-chain is quadratic. Instead anyone may submit a candidate
 * clearing price after the reveal window, and the contract verifies it in a
 * single O(n) pass. A wrong candidate reverts, so the worst an adversary
 * achieves is wasting their own gas.
 *
 * Let D(p) be total demand at price >= p, and S the supply for sale. A
 * candidate p is the clearing price iff D(p) >= S while D(p') < S for the next
 * revealed price p' above p. One scan yields both quantities.
 */
contract LaunchpadAuction is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Price is quoted in wei per WAD launch-token base units.
    uint256 private constant WAD = 1e18;

    enum Phase {
        PENDING,
        COMMIT,
        REVEAL,
        SETTLING,
        SETTLED,
        CANCELLED
    }

    struct Auction {
        address creator;
        address token;
        uint256 supplyForSale;
        uint256 floorPrice;
        uint64 commitStart;
        uint64 commitEnd;
        uint64 revealEnd;
        uint256 totalRevealedDemand;
        uint256 clearingPrice;
        // Pro-rata fraction applied to bids sitting exactly at the clearing price.
        uint256 proRataRemaining;
        uint256 proRataAtPrice;
        uint256 proceeds;
        uint256 totalAllocated;
        bool settled;
        bool cancelled;
        bool tokensReclaimed;
    }

    struct SettlementState {
        uint256 settlementProcessed;
        uint256 allocationProcessed;
        uint256 runningDemand;
        uint256 lastProcessedPrice;
        uint256 clearingDemandAbove;
        uint256 clearingDemandExactly;
        uint256 priceGroupDemandBefore;
        bool clearingFinalized;
    }

    struct Bid {
        uint256 price;
        uint256 amount;
        uint256 deposit;
        bool revealed;
        bool claimed;
    }

    AgentRegistry public immutable registry;

    uint256 public auctionCount;
    mapping(uint256 => Auction) private _auctions;
    mapping(uint256 => mapping(address => bytes32)) public commitmentOf;
    mapping(uint256 => mapping(address => Bid)) private _bids;
    mapping(uint256 => address[]) private _revealedBidders;
    mapping(uint256 => SettlementState) private _settlement;
    mapping(uint256 => mapping(address => bool)) private _settlementProcessed;
    mapping(uint256 => mapping(address => bool)) private _allocationProcessed;

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed creator,
        address indexed token,
        uint256 supplyForSale,
        uint256 floorPrice,
        uint64 commitStart,
        uint64 commitEnd,
        uint64 revealEnd
    );
    event Committed(uint256 indexed auctionId, address indexed bidder, bytes32 commitment, uint256 deposit);
    event Revealed(uint256 indexed auctionId, address indexed bidder, uint256 price, uint256 amount);
    event Settled(uint256 indexed auctionId, uint256 clearingPrice, uint256 totalAllocated);
    event Claimed(uint256 indexed auctionId, address indexed bidder, uint256 allocated, uint256 cost, uint256 refund);
    event Forfeited(uint256 indexed auctionId, address indexed bidder, uint256 deposit);

    error BadWindow();
    error WrongPhase(Phase actual, Phase expected);
    error NotRegistered();
    error AlreadyCommitted();
    error NoCommitment();
    error AlreadyRevealed();
    error BadReveal();
    error BelowFloor();
    error DepositTooSmall(uint256 provided, uint256 required);
    error OverQuota(uint256 requested, uint256 quota);
    error BidsNotSorted();
    error BidAlreadyProcessed();
    error SettlementIncomplete();
    error ClearingAlreadyFinalized();
    error UnknownOrUnrevealedBid();
    error NotSettled();
    error AlreadyClaimed();
    error InvalidClearingPrice();
    error NotCreator();
    error TransferFailed();
    error ZeroAmount();

    constructor(AgentRegistry registry_) {
        registry = registry_;
    }

    // ---------------------------------------------------------------- lifecycle

    function phaseOf(uint256 auctionId) public view returns (Phase) {
        Auction storage a = _auctions[auctionId];
        if (a.creator == address(0)) return Phase.PENDING;
        if (a.cancelled) return Phase.CANCELLED;
        if (a.settled) return Phase.SETTLED;
        if (block.timestamp < a.commitStart) return Phase.PENDING;
        if (block.timestamp < a.commitEnd) return Phase.COMMIT;
        if (block.timestamp < a.revealEnd) return Phase.REVEAL;
        return Phase.SETTLING;
    }

    function auctionOf(uint256 auctionId) external view returns (Auction memory) {
        return _auctions[auctionId];
    }

    function bidOf(uint256 auctionId, address bidder) external view returns (Bid memory) {
        return _bids[auctionId][bidder];
    }

    function revealedBidderCount(uint256 auctionId) external view returns (uint256) {
        return _revealedBidders[auctionId].length;
    }

    function settlementStateOf(uint256 auctionId) external view returns (SettlementState memory) {
        return _settlement[auctionId];
    }

    /// @notice Escrow the sale supply and open an auction.
    function createAuction(
        address token,
        uint256 supplyForSale,
        uint256 floorPrice,
        uint64 commitStart,
        uint64 commitEnd,
        uint64 revealEnd
    ) external returns (uint256 auctionId) {
        if (supplyForSale == 0 || floorPrice == 0) revert ZeroAmount();
        if (!(block.timestamp <= commitStart && commitStart < commitEnd && commitEnd < revealEnd)) {
            revert BadWindow();
        }

        auctionId = auctionCount++;
        Auction storage a = _auctions[auctionId];
        a.creator = msg.sender;
        a.token = token;
        a.supplyForSale = supplyForSale;
        a.floorPrice = floorPrice;
        a.commitStart = commitStart;
        a.commitEnd = commitEnd;
        a.revealEnd = revealEnd;

        IERC20(token).safeTransferFrom(msg.sender, address(this), supplyForSale);

        emit AuctionCreated(
            auctionId, msg.sender, token, supplyForSale, floorPrice, commitStart, commitEnd, revealEnd
        );
    }

    // ------------------------------------------------------------------ bidding

    /**
     * @notice Submit a sealed bid backed by ETH collateral.
     * @param commitment keccak256(abi.encode(auctionId, msg.sender, price, amount, salt))
     *
     * The commitment binds msg.sender, so a sealed bid cannot be lifted out of
     * the mempool and replayed by someone else. Collateral must cover the bid at
     * the bidder's own maximum price; the unused portion is refunded at claim.
     */
    function commit(uint256 auctionId, bytes32 commitment) external payable {
        Phase p = phaseOf(auctionId);
        if (p != Phase.COMMIT) revert WrongPhase(p, Phase.COMMIT);
        if (!registry.isRegistered(msg.sender)) revert NotRegistered();
        if (commitmentOf[auctionId][msg.sender] != bytes32(0)) revert AlreadyCommitted();
        if (msg.value == 0) revert ZeroAmount();

        commitmentOf[auctionId][msg.sender] = commitment;
        _bids[auctionId][msg.sender].deposit = msg.value;

        emit Committed(auctionId, msg.sender, commitment, msg.value);
    }

    /// @notice Open a sealed bid. Unrevealed commitments forfeit their collateral.
    function reveal(uint256 auctionId, uint256 price, uint256 amount, bytes32 salt) external {
        Phase p = phaseOf(auctionId);
        if (p != Phase.REVEAL) revert WrongPhase(p, Phase.REVEAL);

        bytes32 commitment = commitmentOf[auctionId][msg.sender];
        if (commitment == bytes32(0)) revert NoCommitment();

        Bid storage b = _bids[auctionId][msg.sender];
        if (b.revealed) revert AlreadyRevealed();
        if (keccak256(abi.encode(auctionId, msg.sender, price, amount, salt)) != commitment) {
            revert BadReveal();
        }

        Auction storage a = _auctions[auctionId];
        if (amount == 0) revert ZeroAmount();
        if (price < a.floorPrice) revert BelowFloor();

        uint256 quota = registry.quotaOf(msg.sender);
        if (amount > quota) revert OverQuota(amount, quota);

        uint256 required = _cost(amount, price);
        if (b.deposit < required) revert DepositTooSmall(b.deposit, required);

        b.price = price;
        b.amount = amount;
        b.revealed = true;
        a.totalRevealedDemand += amount;
        _revealedBidders[auctionId].push(msg.sender);

        emit Revealed(auctionId, msg.sender, price, amount);
    }

    // ---------------------------------------------------------------- settlement

    /**
     * @notice Fix the uniform clearing price. Permissionless: anyone may settle.
     * @param clearingPrice Candidate price. Reverts unless it is provably the
     * highest price at which revealed demand still covers supply.
     */
    function settle(uint256 auctionId, uint256 clearingPrice) external {
        Phase p = phaseOf(auctionId);
        if (p != Phase.SETTLING) revert WrongPhase(p, Phase.SETTLING);

        Auction storage a = _auctions[auctionId];
        if (clearingPrice < a.floorPrice) revert InvalidClearingPrice();

        (uint256 demandAtOrAbove, uint256 demandStrictlyAbove) = _scan(auctionId, clearingPrice);
        uint256 demandExactly = demandAtOrAbove - demandStrictlyAbove;

        if (a.totalRevealedDemand < a.supplyForSale) {
            // Undersubscribed: the floor is the only price that can clear, and
            // every revealed bid fills completely.
            if (clearingPrice != a.floorPrice) revert InvalidClearingPrice();
            a.proRataRemaining = demandExactly;
            a.proRataAtPrice = demandExactly;
            a.totalAllocated = a.totalRevealedDemand;
        } else {
            // Oversubscribed: p must clear, and the next revealed price above it must not.
            if (demandAtOrAbove < a.supplyForSale) revert InvalidClearingPrice();
            if (demandStrictlyAbove >= a.supplyForSale) revert InvalidClearingPrice();
            // p must itself be a revealed price, otherwise any lower non-bid price
            // would satisfy the two conditions above just as well.
            if (demandExactly == 0 && clearingPrice != a.floorPrice) revert InvalidClearingPrice();

            a.proRataRemaining = a.supplyForSale - demandStrictlyAbove;
            a.proRataAtPrice = demandExactly;
            // Sum the actual per-bid rounded allocations so reclaimUnsold can
            // return pro-rata dust instead of leaving tokens trapped forever.
            a.totalAllocated = _sumAllocations(auctionId, clearingPrice, a.proRataRemaining, demandExactly);
        }

        a.clearingPrice = clearingPrice;
        a.settled = true;

        emit Settled(auctionId, clearingPrice, a.totalAllocated);
    }

    /**
     * @notice Submit revealed bidders in non-increasing price order, over any number of bounded transactions.
     * @dev Every revealed bidder must be submitted exactly once before finalizing the clearing price.
     */
    function submitSettlementBatch(uint256 auctionId, address[] calldata bidders) external {
        Phase p = phaseOf(auctionId);
        if (p != Phase.SETTLING) revert WrongPhase(p, Phase.SETTLING);
        Auction storage a = _auctions[auctionId];
        SettlementState storage s = _settlement[auctionId];
        if (s.clearingFinalized) revert ClearingAlreadyFinalized();

        for (uint256 i = 0; i < bidders.length; ++i) {
            address bidder = bidders[i];
            Bid storage b = _bids[auctionId][bidder];
            if (!b.revealed) revert UnknownOrUnrevealedBid();
            if (_settlementProcessed[auctionId][bidder]) revert BidAlreadyProcessed();
            if (s.settlementProcessed != 0 && b.price > s.lastProcessedPrice) revert BidsNotSorted();

            if (s.settlementProcessed == 0 || b.price < s.lastProcessedPrice) {
                s.priceGroupDemandBefore = s.runningDemand;
            }
            s.runningDemand += b.amount;
            s.lastProcessedPrice = b.price;
            _settlementProcessed[auctionId][bidder] = true;
            ++s.settlementProcessed;

            if (a.clearingPrice == 0 && s.runningDemand >= a.supplyForSale) {
                a.clearingPrice = b.price;
                s.clearingDemandAbove = s.priceGroupDemandBefore;
                s.clearingDemandExactly = s.runningDemand - s.priceGroupDemandBefore;
            } else if (a.clearingPrice != 0 && b.price == a.clearingPrice) {
                s.clearingDemandExactly += b.amount;
            }
        }
    }

    function finalizeClearing(uint256 auctionId) external {
        Phase p = phaseOf(auctionId);
        if (p != Phase.SETTLING) revert WrongPhase(p, Phase.SETTLING);
        Auction storage a = _auctions[auctionId];
        SettlementState storage s = _settlement[auctionId];
        if (s.clearingFinalized) revert ClearingAlreadyFinalized();
        if (s.settlementProcessed != _revealedBidders[auctionId].length) revert SettlementIncomplete();

        if (a.totalRevealedDemand < a.supplyForSale) {
            a.clearingPrice = a.floorPrice;
            s.clearingDemandAbove = a.totalRevealedDemand;
            s.clearingDemandExactly = 0;
            a.proRataRemaining = 0;
            a.proRataAtPrice = 0;
        } else {
            a.proRataRemaining = a.supplyForSale - s.clearingDemandAbove;
            a.proRataAtPrice = s.clearingDemandExactly;
        }
        s.clearingFinalized = true;
    }

    /** Submit every revealed bidder once to sum actual rounded allocations in bounded transactions. */
    function submitAllocationBatch(uint256 auctionId, address[] calldata bidders) external {
        Auction storage a = _auctions[auctionId];
        SettlementState storage s = _settlement[auctionId];
        if (!s.clearingFinalized || a.settled) revert SettlementIncomplete();
        for (uint256 i = 0; i < bidders.length; ++i) {
            address bidder = bidders[i];
            Bid storage b = _bids[auctionId][bidder];
            if (!b.revealed) revert UnknownOrUnrevealedBid();
            if (_allocationProcessed[auctionId][bidder]) revert BidAlreadyProcessed();
            _allocationProcessed[auctionId][bidder] = true;
            ++s.allocationProcessed;
            if (b.price > a.clearingPrice) a.totalAllocated += b.amount;
            else if (b.price == a.clearingPrice && a.proRataAtPrice != 0) {
                a.totalAllocated += (b.amount * a.proRataRemaining) / a.proRataAtPrice;
            } else if (a.totalRevealedDemand < a.supplyForSale) {
                a.totalAllocated += b.amount;
            }
        }
    }

    function finalizeSettlement(uint256 auctionId) external {
        Auction storage a = _auctions[auctionId];
        SettlementState storage s = _settlement[auctionId];
        if (!s.clearingFinalized || s.allocationProcessed != _revealedBidders[auctionId].length) {
            revert SettlementIncomplete();
        }
        a.settled = true;
        emit Settled(auctionId, a.clearingPrice, a.totalAllocated);
    }

    /// @dev Legacy one-transaction settlement retained for small local auctions.
    /// Single pass over revealed bids. Returns (D(p), D(next price above p)).
    function _scan(uint256 auctionId, uint256 p)
        private
        view
        returns (uint256 atOrAbove, uint256 strictlyAbove)
    {
        address[] storage bidders = _revealedBidders[auctionId];
        uint256 n = bidders.length;
        for (uint256 i = 0; i < n; ++i) {
            Bid storage b = _bids[auctionId][bidders[i]];
            if (b.price > p) {
                strictlyAbove += b.amount;
                atOrAbove += b.amount;
            } else if (b.price == p) {
                atOrAbove += b.amount;
            }
        }
    }

    function _sumAllocations(uint256 auctionId, uint256 clearingPrice, uint256 remaining, uint256 atPrice)
        private
        view
        returns (uint256 total)
    {
        address[] storage bidders = _revealedBidders[auctionId];
        for (uint256 i = 0; i < bidders.length; ++i) {
            Bid storage b = _bids[auctionId][bidders[i]];
            if (b.price > clearingPrice) total += b.amount;
            else if (b.price == clearingPrice && atPrice != 0) total += (b.amount * remaining) / atPrice;
        }
    }

    /// @notice Allocation for a bid. Meaningful only after settlement.
    function allocationOf(uint256 auctionId, address bidder) public view returns (uint256) {
        Auction storage a = _auctions[auctionId];
        Bid storage b = _bids[auctionId][bidder];
        if (!a.settled || !b.revealed) return 0;

        if (b.price > a.clearingPrice) return b.amount;
        if (b.price < a.clearingPrice) return 0;
        if (a.proRataAtPrice == 0) return 0;
        // Rounds down; residual dust returns to the creator via reclaimUnsold().
        return (b.amount * a.proRataRemaining) / a.proRataAtPrice;
    }

    /// @notice Collect tokens won plus the unspent portion of the collateral.
    function claim(uint256 auctionId) external nonReentrant {
        Auction storage a = _auctions[auctionId];
        if (!a.settled) revert NotSettled();

        Bid storage b = _bids[auctionId][msg.sender];
        if (b.claimed) revert AlreadyClaimed();
        if (!b.revealed) revert BadReveal(); // unrevealed collateral is forfeited, not refunded
        b.claimed = true;

        uint256 allocated = allocationOf(auctionId, msg.sender);
        uint256 cost = _cost(allocated, a.clearingPrice);
        uint256 refund = b.deposit - cost;
        a.proceeds += cost;

        if (allocated > 0) IERC20(a.token).safeTransfer(msg.sender, allocated);
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert TransferFailed();
        }

        emit Claimed(auctionId, msg.sender, allocated, cost, refund);
    }

    /**
     * @notice Sweep collateral from commitments that were never opened.
     * @dev Without forfeiture, a bidder could commit aggressively and then stay
     * silent whenever the outcome turned against them: a free option on the auction.
     */
    function sweepForfeited(uint256 auctionId, address[] calldata bidders) external nonReentrant {
        Auction storage a = _auctions[auctionId];
        if (!a.settled) revert NotSettled();
        if (msg.sender != a.creator) revert NotCreator();

        uint256 swept;
        for (uint256 i = 0; i < bidders.length; ++i) {
            Bid storage b = _bids[auctionId][bidders[i]];
            if (b.revealed || b.claimed || b.deposit == 0) continue;
            b.claimed = true;
            swept += b.deposit;
            emit Forfeited(auctionId, bidders[i], b.deposit);
        }
        a.proceeds += swept;
    }

    function withdrawProceeds(uint256 auctionId) external nonReentrant {
        Auction storage a = _auctions[auctionId];
        if (!a.settled) revert NotSettled();
        if (msg.sender != a.creator) revert NotCreator();

        uint256 amount = a.proceeds;
        a.proceeds = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Return supply that went unsold, plus pro-rata rounding dust.
    function reclaimUnsold(uint256 auctionId) external nonReentrant {
        Auction storage a = _auctions[auctionId];
        if (!a.settled) revert NotSettled();
        if (msg.sender != a.creator) revert NotCreator();
        if (a.tokensReclaimed) revert AlreadyClaimed();
        a.tokensReclaimed = true;

        uint256 unsold = a.supplyForSale - a.totalAllocated;
        if (unsold > 0) IERC20(a.token).safeTransfer(a.creator, unsold);
    }

    function _cost(uint256 amount, uint256 price) private pure returns (uint256) {
        return (amount * price) / WAD;
    }
}

