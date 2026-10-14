// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MintTax} from "./interfaces/PortusTypes.sol";

/// @notice Mint-mode constant-product pool (launch token / quote asset).
///
/// - Opens only through `initialize`, called once by its Sale inside
///   `finalize()`, at exactly the subscription price.
/// - There is no LP share and no way to add or remove liquidity: the genesis
///   liquidity stays in the pool for good.
/// - The trading tax is taken in the launch token, never in the quote asset:
///   buys pay it on the tokens out, sells on the tokens in. Each side burns a
///   part and pays two fixed recipients. A sell whose price impact exceeds
///   `dumpThresholdBps` also pays the excess impact as a levy, part burned and
///   the rest to the market-management address. All rates are fixed at creation.
/// - Pricing reads internal reserves; `sync` folds stray balances (such as the
///   Sale's rounding dust) into the reserves, deepening the locked liquidity.
contract PortusTaxPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant Q112 = 2 ** 112;

    // Same shapes as IPortusPool, so indexers and charts read both pool kinds.
    event Initialized(uint256 quoteReserve, uint256 tokenReserve, uint256 shares, address indexed locker);
    event Swap(
        address indexed sender,
        address indexed to,
        bool indexed isBuy,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeQuote,
        uint112 quoteReserve,
        uint112 tokenReserve
    );
    /// @param second Foundation share on buys, tech share on sells.
    event Taxed(
        bool indexed isBuy, uint256 burned, uint256 community, uint256 second, uint256 dumpBurned, uint256 dumpMarket
    );
    event Synced(uint112 quoteReserve, uint112 tokenReserve);

    error NotFactory();
    error SaleAlreadyBound();
    error NotSale();
    error AlreadyInitialized();
    error NotInitialized();
    error InsufficientInitialBalance();
    error Expired();
    error InvalidRecipient();
    error ZeroAmount();
    error InsufficientOutput();
    error SlippageExceeded(uint256 minOut, uint256 out);
    error ReserveOverflow();
    error UnsupportedToken();
    error KInvariant();

    struct Cut {
        uint256 burn;
        uint256 community;
        uint256 second;
        uint256 dumpBurn;
        uint256 dumpMarket;
    }

    address public immutable factory;
    address public immutable token;
    address public immutable quoteAsset;

    uint16 public immutable buyBurnBps;
    uint16 public immutable buyCommunityBps;
    uint16 public immutable buyFoundationBps;
    uint16 public immutable sellBurnBps;
    uint16 public immutable sellCommunityBps;
    uint16 public immutable sellTechBps;
    uint16 public immutable dumpThresholdBps;
    uint16 public immutable dumpBurnShareBps;
    address public immutable community;
    address public immutable foundation;
    address public immutable tech;
    address public immutable market;

    address public sale;
    bool public initialized;

    uint112 private reserveQuote;
    uint112 private reserveToken;
    uint32 private blockTimestampLast;
    uint256 public priceQuoteCumulativeLast;

    constructor(address factory_, address token_, address quoteAsset_, MintTax memory t) {
        factory = factory_;
        token = token_;
        quoteAsset = quoteAsset_;
        buyBurnBps = t.buyBurnBps;
        buyCommunityBps = t.buyCommunityBps;
        buyFoundationBps = t.buyFoundationBps;
        sellBurnBps = t.sellBurnBps;
        sellCommunityBps = t.sellCommunityBps;
        sellTechBps = t.sellTechBps;
        dumpThresholdBps = t.dumpThresholdBps;
        dumpBurnShareBps = t.dumpBurnShareBps;
        community = t.community;
        foundation = t.foundation;
        tech = t.tech;
        market = t.market;
    }

    // ─── one-time wiring ──────────────────────────────────────────────────────

    function bindSale(address sale_) external {
        if (msg.sender != factory) revert NotFactory();
        if (sale != address(0)) revert SaleAlreadyBound();
        sale = sale_;
    }

    /// @dev Signature matches IPortusPool.initialize so PortusSale can call it.
    /// Returns 0: this pool issues no LP shares.
    function initialize(uint256 quoteAmount, uint256 tokenAmount) external nonReentrant returns (uint256) {
        if (msg.sender != sale || sale == address(0)) revert NotSale();
        if (initialized) revert AlreadyInitialized();
        if (quoteAmount == 0 || tokenAmount == 0) revert ZeroAmount();
        if (
            IERC20(quoteAsset).balanceOf(address(this)) < quoteAmount
                || IERC20(token).balanceOf(address(this)) < tokenAmount
        ) revert InsufficientInitialBalance();
        if (quoteAmount >= Q112 || tokenAmount >= Q112) revert ReserveOverflow();

        initialized = true;
        _update(quoteAmount, tokenAmount);
        emit Initialized(quoteAmount, tokenAmount, 0, address(0));
        return 0;
    }

    // ─── trading ──────────────────────────────────────────────────────────────

    function buy(uint256 quoteIn, uint256 minTokensOut, address to, uint256 deadline)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        _checkCall(quoteIn, to, deadline);
        _pullExact(quoteAsset, quoteIn);

        uint256 q = reserveQuote;
        uint256 t = reserveToken;
        uint256 gross = Math.mulDiv(quoteIn, t, q + quoteIn);
        Cut memory c = _buyCut(gross);
        tokensOut = gross - _sum(c);
        if (tokensOut == 0) revert InsufficientOutput();
        if (tokensOut < minTokensOut) revert SlippageExceeded(minTokensOut, tokensOut);

        uint256 newQ = q + quoteIn;
        uint256 newT = t - gross;
        _commitSwap(q, t, newQ, newT);

        _payCut(c, buyFoundationBps > 0 ? foundation : address(0));
        IERC20(token).safeTransfer(to, tokensOut);
        emit Taxed(true, c.burn, c.community, c.second, 0, 0);
        emit Swap(msg.sender, to, true, quoteIn, tokensOut, 0, uint112(newQ), uint112(newT));
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut, address to, uint256 deadline)
        external
        nonReentrant
        returns (uint256 quoteOut)
    {
        _checkCall(tokensIn, to, deadline);
        _pullExact(token, tokensIn);

        uint256 q = reserveQuote;
        uint256 t = reserveToken;
        (Cut memory c, uint256 net) = _sellCut(tokensIn, t);
        quoteOut = net == 0 ? 0 : Math.mulDiv(net, q, t + net);
        if (quoteOut == 0) revert InsufficientOutput();
        if (quoteOut < minQuoteOut) revert SlippageExceeded(minQuoteOut, quoteOut);

        uint256 newQ = q - quoteOut;
        uint256 newT = t + net;
        _commitSwap(q, t, newQ, newT);

        _payCut(c, sellTechBps > 0 ? tech : address(0));
        IERC20(quoteAsset).safeTransfer(to, quoteOut);
        emit Taxed(false, c.burn, c.community, c.second, c.dumpBurn, c.dumpMarket);
        emit Swap(msg.sender, to, false, tokensIn, quoteOut, 0, uint112(newQ), uint112(newT));
    }

    /// @notice Fold balances above the reserves into the reserves. With no LP
    /// shares, a donation only deepens the permanently locked liquidity.
    function sync() external nonReentrant {
        if (!initialized) revert NotInitialized();
        uint256 q = IERC20(quoteAsset).balanceOf(address(this));
        uint256 t = IERC20(token).balanceOf(address(this));
        if (q >= Q112 || t >= Q112) revert ReserveOverflow();
        _update(q, t);
        emit Synced(uint112(q), uint112(t));
    }

    // ─── views ────────────────────────────────────────────────────────────────

    function getReserves() external view returns (uint112 quoteReserve, uint112 tokenReserve, uint32 ts) {
        return (reserveQuote, reserveToken, blockTimestampLast);
    }

    /// @return tokensOut What the buyer receives.
    /// @return taxTokens Tokens withheld as tax (burned plus paid out).
    function quoteBuy(uint256 quoteIn) external view returns (uint256 tokensOut, uint256 taxTokens) {
        if (!initialized) revert NotInitialized();
        uint256 gross = Math.mulDiv(quoteIn, reserveToken, uint256(reserveQuote) + quoteIn);
        taxTokens = _sum(_buyCut(gross));
        tokensOut = gross - taxTokens;
    }

    /// @return quoteOut What the seller receives.
    /// @return taxTokens Tokens withheld as tax, including any anti-dump levy.
    function quoteSell(uint256 tokensIn) external view returns (uint256 quoteOut, uint256 taxTokens) {
        if (!initialized) revert NotInitialized();
        uint256 t = reserveToken;
        (Cut memory c, uint256 net) = _sellCut(tokensIn, t);
        taxTokens = _sum(c);
        quoteOut = net == 0 ? 0 : Math.mulDiv(net, reserveQuote, t + net);
    }

    function currentCumulativePrice() external view returns (uint256 quoteCumulative, uint32 timestamp) {
        if (!initialized) revert NotInitialized();
        timestamp = uint32(block.timestamp);
        quoteCumulative = priceQuoteCumulativeLast;
        unchecked {
            uint32 elapsed = timestamp - blockTimestampLast;
            if (elapsed > 0) quoteCumulative += ((uint256(reserveQuote) * Q112) / reserveToken) * elapsed;
        }
    }

    // ─── internals ────────────────────────────────────────────────────────────

    function _buyCut(uint256 gross) private view returns (Cut memory c) {
        c.burn = (gross * buyBurnBps) / BPS;
        c.community = (gross * buyCommunityBps) / BPS;
        c.second = (gross * buyFoundationBps) / BPS;
    }

    /// Sell: base tax on tokensIn; then, if the remaining amount would move the
    /// price by more than the threshold (impact = net / (T + net)), the excess
    /// impact is levied on it as well.
    function _sellCut(uint256 tokensIn, uint256 t) private view returns (Cut memory c, uint256 net) {
        c.burn = (tokensIn * sellBurnBps) / BPS;
        c.community = (tokensIn * sellCommunityBps) / BPS;
        c.second = (tokensIn * sellTechBps) / BPS;
        net = tokensIn - c.burn - c.community - c.second;
        if (dumpThresholdBps > 0 && net > 0) {
            uint256 impactBps = (net * BPS) / (t + net);
            if (impactBps > dumpThresholdBps) {
                uint256 levy = (net * (impactBps - dumpThresholdBps)) / BPS;
                c.dumpBurn = (levy * dumpBurnShareBps) / BPS;
                c.dumpMarket = levy - c.dumpBurn;
                net -= levy;
            }
        }
    }

    function _sum(Cut memory c) private pure returns (uint256) {
        return c.burn + c.community + c.second + c.dumpBurn + c.dumpMarket;
    }

    function _payCut(Cut memory c, address second) private {
        uint256 burnAmount = c.burn + c.dumpBurn;
        if (burnAmount > 0) ERC20Burnable(token).burn(burnAmount);
        if (c.community > 0) IERC20(token).safeTransfer(community, c.community);
        if (c.second > 0) IERC20(token).safeTransfer(second, c.second);
        if (c.dumpMarket > 0) IERC20(token).safeTransfer(market, c.dumpMarket);
    }

    function _checkCall(uint256 amountIn, address to, uint256 deadline) private view {
        if (!initialized) revert NotInitialized();
        if (block.timestamp > deadline) revert Expired();
        if (to == address(0) || to == address(this) || to == token || to == quoteAsset) revert InvalidRecipient();
        if (amountIn == 0) revert ZeroAmount();
    }

    /// @dev Balance-difference check rejects fee-on-transfer and rebasing assets.
    function _pullExact(address asset, uint256 amount) private {
        uint256 before = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        if (IERC20(asset).balanceOf(address(this)) - before != amount) revert UnsupportedToken();
    }

    function _commitSwap(uint256 q, uint256 t, uint256 newQ, uint256 newT) private {
        if (newQ >= Q112 || newT >= Q112) revert ReserveOverflow();
        if (newQ * newT < q * t) revert KInvariant();
        _update(newQ, newT);
    }

    function _update(uint256 newQ, uint256 newT) private {
        uint32 ts = uint32(block.timestamp);
        unchecked {
            uint32 elapsed = ts - blockTimestampLast;
            if (elapsed > 0 && reserveQuote != 0 && reserveToken != 0) {
                priceQuoteCumulativeLast += ((uint256(reserveQuote) * Q112) / reserveToken) * elapsed;
            }
        }
        reserveQuote = uint112(newQ);
        reserveToken = uint112(newT);
        blockTimestampLast = ts;
    }
}
