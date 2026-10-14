// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPortusPool} from "./interfaces/IPortusPool.sol";
import {IPortusLocker} from "./interfaces/IPortusLocker.sol";
import {IPortusFeeSplitter} from "./interfaces/IPortusFeeSplitter.sol";
import {PortusMath} from "./libraries/PortusMath.sol";

/// @notice Single-pair constant-product pool (launch token / quote asset).
///
/// - Opens only through `initialize`, called once by its Sale inside
///   `finalize()`, so nobody can trade between settlement and the opening price.
/// - The genesis LP position is booked to the Locker, which has no outbound
///   path: it is locked forever. Third parties may add and remove their own
///   liquidity (the radar's LP mining rewards them; fees do not).
/// - Fees are charged in the quote asset only and go to the FeeSplitter in the
///   same call. They never enter the reserves.
/// - Pricing reads internal reserves, never balanceOf. Donations do not move the
///   price; `skim` routes them away (quote → FeeSplitter as fees, tokens → burn).
contract PortusPool is IPortusPool, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    uint256 private constant Q112 = 2 ** 112;

    address public immutable factory;
    address public immutable token;
    address public immutable quoteAsset;
    address public immutable locker;
    address public immutable feeSplitter;
    uint16 public immutable feeBps;

    address public sale;

    uint112 private reserveQuote;
    uint112 private reserveToken;
    uint32 private blockTimestampLast;

    /// @notice UQ112x112 quote-per-token price, time-weighted (Uniswap V2 scheme).
    uint256 public priceQuoteCumulativeLast;
    /// @notice UQ112x112 token-per-quote price, time-weighted.
    uint256 public priceTokenCumulativeLast;

    uint256 public totalShares;
    /// @notice Shares minted to the Locker at initialisation; never redeemable.
    uint256 public lockedShares;
    mapping(address => uint256) public sharesOf;
    bool public initialized;

    constructor(
        address factory_,
        address token_,
        address quoteAsset_,
        uint16 feeBps_,
        address locker_,
        address feeSplitter_
    ) {
        factory = factory_;
        token = token_;
        quoteAsset = quoteAsset_;
        feeBps = feeBps_;
        locker = locker_;
        feeSplitter = feeSplitter_;
    }

    // ─── one-time wiring ──────────────────────────────────────────────────────

    function bindSale(address sale_) external {
        if (msg.sender != factory) revert NotFactory();
        if (sale != address(0)) revert SaleAlreadyBound();
        sale = sale_;
    }

    function initialize(uint256 quoteAmount, uint256 tokenAmount) external nonReentrant returns (uint256 shares) {
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

        // No MINIMUM_LIQUIDITY: the locked genesis shares can never be burned,
        // so the first-depositor share inflation attack has nothing to attack.
        shares = Math.sqrt(quoteAmount * tokenAmount);
        totalShares = shares;
        lockedShares = shares;
        sharesOf[locker] = shares;
        IPortusLocker(locker).notifyLocked(shares);

        emit Initialized(quoteAmount, tokenAmount, shares, locker);
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
        uint256 fee;
        (tokensOut, fee) = _quoteBuy(quoteIn, q, t);
        if (tokensOut == 0) revert InsufficientOutput();
        if (tokensOut < minTokensOut) revert SlippageExceeded(minTokensOut, tokensOut);

        uint256 newQ = q + (quoteIn - fee);
        uint256 newT = t - tokensOut;
        _commitSwap(q, t, newQ, newT);

        _payFee(fee);
        IERC20(token).safeTransfer(to, tokensOut);
        emit Swap(msg.sender, to, true, quoteIn, tokensOut, fee, uint112(newQ), uint112(newT));
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
        uint256 fee;
        (quoteOut, fee) = _quoteSell(tokensIn, q, t);
        if (quoteOut == 0) revert InsufficientOutput();
        if (quoteOut < minQuoteOut) revert SlippageExceeded(minQuoteOut, quoteOut);

        uint256 newQ = q - (quoteOut + fee);
        uint256 newT = t + tokensIn;
        _commitSwap(q, t, newQ, newT);

        _payFee(fee);
        IERC20(quoteAsset).safeTransfer(to, quoteOut);
        emit Swap(msg.sender, to, false, tokensIn, quoteOut, fee, uint112(newQ), uint112(newT));
    }

    // ─── third-party liquidity ────────────────────────────────────────────────

    /// @notice Add liquidity at the current ratio. `quoteIn` fixes the size; the
    /// matching token amount is rounded up (in the pool's favour) and must not
    /// exceed `maxTokensIn`. Shares are rounded down.
    function addLiquidity(uint256 quoteIn, uint256 maxTokensIn, uint256 minShares, address to, uint256 deadline)
        external
        nonReentrant
        returns (uint256 shares, uint256 tokensIn)
    {
        _checkCall(quoteIn, to, deadline);
        uint256 q = reserveQuote;
        uint256 t = reserveToken;
        tokensIn = Math.mulDiv(quoteIn, t, q, Math.Rounding.Ceil);
        if (tokensIn > maxTokensIn) revert SlippageExceeded(maxTokensIn, tokensIn);
        shares = Math.mulDiv(quoteIn, totalShares, q);
        if (shares == 0) revert InsufficientOutput();
        if (shares < minShares) revert SlippageExceeded(minShares, shares);

        _pullExact(quoteAsset, quoteIn);
        _pullExact(token, tokensIn);

        if (q + quoteIn >= Q112 || t + tokensIn >= Q112) revert ReserveOverflow();
        _update(q + quoteIn, t + tokensIn);
        totalShares += shares;
        sharesOf[to] += shares;
        emit LiquidityAdded(msg.sender, to, quoteIn, tokensIn, shares, reserveQuote, reserveToken);
    }

    /// @notice Burn the caller's own shares for a pro-rata slice of both reserves
    /// (rounded down). The Locker's genesis shares can never come out: the Locker
    /// has no function that calls this.
    function removeLiquidity(uint256 shares, uint256 minQuoteOut, uint256 minTokensOut, address to, uint256 deadline)
        external
        nonReentrant
        returns (uint256 quoteOut, uint256 tokensOut)
    {
        _checkCall(shares, to, deadline);
        if (msg.sender == locker) revert LockedShares();
        if (sharesOf[msg.sender] < shares) revert InsufficientShares();

        uint256 q = reserveQuote;
        uint256 t = reserveToken;
        uint256 total = totalShares;
        quoteOut = Math.mulDiv(shares, q, total);
        tokensOut = Math.mulDiv(shares, t, total);
        if (quoteOut == 0 || tokensOut == 0) revert InsufficientOutput();
        if (quoteOut < minQuoteOut) revert SlippageExceeded(minQuoteOut, quoteOut);
        if (tokensOut < minTokensOut) revert SlippageExceeded(minTokensOut, tokensOut);

        sharesOf[msg.sender] -= shares;
        totalShares = total - shares;
        _update(q - quoteOut, t - tokensOut);

        IERC20(quoteAsset).safeTransfer(to, quoteOut);
        IERC20(token).safeTransfer(to, tokensOut);
        emit LiquidityRemoved(msg.sender, to, quoteOut, tokensOut, shares, reserveQuote, reserveToken);
    }

    /// @notice Clear balances above the reserves: quote is split as fees, tokens burned.
    function skim() external nonReentrant {
        uint256 extraQuote = IERC20(quoteAsset).balanceOf(address(this)) - reserveQuote;
        uint256 extraTokens = IERC20(token).balanceOf(address(this)) - reserveToken;
        if (extraQuote > 0) {
            IERC20(quoteAsset).safeTransfer(feeSplitter, extraQuote);
            IPortusFeeSplitter(feeSplitter).onFee(extraQuote);
        }
        if (extraTokens > 0) ERC20Burnable(token).burn(extraTokens);
        emit Skimmed(extraQuote, extraTokens);
    }

    // ─── views ────────────────────────────────────────────────────────────────

    function getReserves() external view returns (uint112 quoteReserve, uint112 tokenReserve, uint32 ts) {
        return (reserveQuote, reserveToken, blockTimestampLast);
    }

    function quoteBuy(uint256 quoteIn) external view returns (uint256 tokensOut, uint256 fee) {
        if (!initialized) revert NotInitialized();
        return _quoteBuy(quoteIn, reserveQuote, reserveToken);
    }

    function quoteSell(uint256 tokensIn) external view returns (uint256 quoteOut, uint256 fee) {
        if (!initialized) revert NotInitialized();
        return _quoteSell(tokensIn, reserveQuote, reserveToken);
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

    /// Buy: fee = ceil(qIn·f/B) off the input; tOut = floor(qNet·T / (Q + qNet)).
    function _quoteBuy(uint256 quoteIn, uint256 q, uint256 t) private view returns (uint256 tokensOut, uint256 fee) {
        fee = PortusMath.mulDivUp(quoteIn, feeBps, BPS);
        uint256 net = quoteIn - fee;
        tokensOut = net == 0 ? 0 : Math.mulDiv(net, t, q + net);
    }

    /// Sell: qGross = floor(tIn·Q / (T + tIn)); fee = ceil(qGross·f/B) off the output.
    function _quoteSell(uint256 tokensIn, uint256 q, uint256 t) private view returns (uint256 quoteOut, uint256 fee) {
        uint256 gross = Math.mulDiv(tokensIn, q, t + tokensIn);
        fee = PortusMath.mulDivUp(gross, feeBps, BPS);
        quoteOut = gross - fee;
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
        // Rounding always favours the pool; keep the assertion as a tripwire.
        if (newQ * newT < q * t) revert KInvariant();
        _update(newQ, newT);
    }

    /// @dev Fees round up and are ≥ 1% of a non-zero input, so this is never
    /// called with 0 on a successful swap.
    function _payFee(uint256 fee) private {
        IERC20(quoteAsset).safeTransfer(feeSplitter, fee);
        IPortusFeeSplitter(feeSplitter).onFee(fee);
        emit FeePaid(feeSplitter, fee);
    }

    /// @dev Uniswap V2 oracle accumulation: integrate the price that held since
    /// the last update, then store the new reserves. Overflow is intended.
    function _update(uint256 newQ, uint256 newT) private {
        uint32 ts = uint32(block.timestamp);
        unchecked {
            uint32 elapsed = ts - blockTimestampLast;
            if (elapsed > 0 && reserveQuote != 0 && reserveToken != 0) {
                priceQuoteCumulativeLast += ((uint256(reserveQuote) * Q112) / reserveToken) * elapsed;
                priceTokenCumulativeLast += ((uint256(reserveToken) * Q112) / reserveQuote) * elapsed;
            }
        }
        reserveQuote = uint112(newQ);
        reserveToken = uint112(newT);
        blockTimestampLast = ts;
    }
}
