// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Phase, Outcome} from "./PortusTypes.sol";

/// @notice Fixed-price whitelist subscription whose proceeds can only go into
/// the launch pool or back to subscribers. There is no creator withdrawal path.
interface IPortusSale {
    event Subscribed(
        address indexed account, uint256 amount, uint256 totalForAccount, uint256 totalCommitted, bool viaWhitelist
    );
    event Finalized(
        uint8 indexed outcome,
        uint256 totalCommitted,
        uint256 poolQuote,
        uint256 poolTokens,
        uint256 tokensForClaims,
        uint256 quoteForRefunds,
        uint256 incentiveFunded,
        uint256 tokensBurned,
        uint256 quoteDustToSink
    );
    event Claimed(address indexed account, uint256 tokens, uint256 refund, address indexed caller);
    event DustSwept(uint256 tokensBurned, uint256 quoteToSink);

    error NotOpen();
    error PublicNotOpen();
    error InvalidProof();
    error CapExceeded(uint256 cap, uint256 wouldBe);
    error ZeroAmount();
    error UnsupportedQuoteToken();
    error TotalCommitTooLarge();
    error NotAwaitingFinalize();
    error NotSettled();
    error NothingToClaim();
    error AlreadyClaimed();
    error ClaimsOutstanding();
    error AlreadySwept();

    function subscribe(uint256 amount, uint256 cap, bytes32[] calldata proof) external;
    function subscribePublic(uint256 amount) external;
    function finalize() external;
    function claim() external returns (uint256 tokens, uint256 refund);
    function claimFor(address account) external returns (uint256 tokens, uint256 refund);
    function sweepDust() external;

    function phase() external view returns (Phase);
    function outcome() external view returns (Outcome);
    function previewClaim(address account) external view returns (uint256 tokens, uint256 refund);
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
        );
}
