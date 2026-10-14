// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Single-pair constant-product pool. Its genesis LP position is locked
/// forever; third parties may add and remove their own liquidity. Fees are
/// charged in the quote asset and go straight to the FeeSplitter, so they never
/// enter the reserves.
interface IPortusPool {
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
    event FeePaid(address indexed splitter, uint256 amount);
    event Skimmed(uint256 quoteToSplitter, uint256 tokensBurned);
    event LiquidityAdded(
        address indexed provider, address indexed to, uint256 quoteIn, uint256 tokensIn, uint256 shares, uint112 quoteReserve, uint112 tokenReserve
    );
    event LiquidityRemoved(
        address indexed provider, address indexed to, uint256 quoteOut, uint256 tokensOut, uint256 shares, uint112 quoteReserve, uint112 tokenReserve
    );

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
    error InsufficientShares();
    error LockedShares();

    function factory() external view returns (address);
    function token() external view returns (address);
    function quoteAsset() external view returns (address);
    function locker() external view returns (address);
    function feeSplitter() external view returns (address);
    function feeBps() external view returns (uint16);
    function sale() external view returns (address);
    function initialized() external view returns (bool);
    function totalShares() external view returns (uint256);
    function lockedShares() external view returns (uint256);
    function sharesOf(address account) external view returns (uint256);
    function priceQuoteCumulativeLast() external view returns (uint256);
    function priceTokenCumulativeLast() external view returns (uint256);

    function bindSale(address sale_) external;
    function initialize(uint256 quoteAmount, uint256 tokenAmount) external returns (uint256 shares);

    function buy(uint256 quoteIn, uint256 minTokensOut, address to, uint256 deadline)
        external
        returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address to, uint256 deadline)
        external
        returns (uint256 quoteOut);
    function addLiquidity(uint256 quoteIn, uint256 maxTokensIn, uint256 minShares, address to, uint256 deadline)
        external
        returns (uint256 shares, uint256 tokensIn);
    function removeLiquidity(uint256 shares, uint256 minQuoteOut, uint256 minTokensOut, address to, uint256 deadline)
        external
        returns (uint256 quoteOut, uint256 tokensOut);
    function skim() external;

    function getReserves() external view returns (uint112 quoteReserve, uint112 tokenReserve, uint32 ts);
    function quoteBuy(uint256 quoteIn) external view returns (uint256 tokensOut, uint256 fee);
    function quoteSell(uint256 tokensIn) external view returns (uint256 quoteOut, uint256 fee);
    /// @notice Cumulative quote-per-token price (UQ112x112 · seconds) as of now,
    /// including the time since the last update (Uniswap V2 oracle convention).
    function currentCumulativePrice() external view returns (uint256 quoteCumulative, uint32 timestamp);
}
