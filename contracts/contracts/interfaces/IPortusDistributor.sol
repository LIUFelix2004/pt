// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Pays out radar incentives (launch token, released daily) and
/// treasury TWAB rewards (quote asset) by published Merkle roots.
///
/// A pot is (token, asset): asset == token for the incentive pool, the quote
/// asset for treasury rewards. Each published epoch total is bounded by what
/// the pot can actually pay (released or funded, minus already allocated), and
/// becomes claimable only after a 24h challenge delay. Unclaimed amounts never
/// expire.
interface IPortusDistributor {
    event LaunchRegistered(address indexed token, address sale, address treasury, uint8 releaseMode, uint16 releaseRateBps);
    event IncentiveFunded(address indexed token, uint256 amount, uint64 start);
    event TreasuryFunded(address indexed token, address indexed asset, uint256 amount);
    event RootPublished(
        address indexed token, address indexed asset, uint256 indexed epoch, bytes32 root, uint256 total, uint64 claimableAt, string dataURI
    );
    event Claimed(address indexed token, address indexed asset, uint256 indexed epoch, address account, uint256 amount);
    event ReferrerBound(address indexed account, address indexed referrer);

    error NotFactory();
    error NotPublisher();
    error UnknownLaunch();
    error NotSale();
    error NotTreasury();
    error FundingMismatch();
    error AlreadyFunded();
    error ExceedsAvailable(uint256 available, uint256 requested);
    error NotClaimable(uint64 claimableAt);
    error AlreadyClaimed();
    error InvalidProof();
    error EpochOverdrawn();
    error InvalidReferrer();
    error ReferrerAlreadySet();

    function CHALLENGE_PERIOD() external view returns (uint256);
    function factory() external view returns (address);
    function rootPublisher() external view returns (address);

    function registerLaunch(address token, address sale, address treasury, uint8 releaseMode, uint16 releaseRateBps)
        external;
    function notifyIncentive(uint256 amount) external;
    function fundTreasury(address token, address asset, uint256 amount) external;

    function released(address token) external view returns (uint256);
    function available(address token, address asset) external view returns (uint256);
    function epochCount(address token, address asset) external view returns (uint256);

    function publishRoot(address token, address asset, bytes32 root, uint256 total, string calldata dataURI)
        external
        returns (uint256 epoch);
    function claim(address token, address asset, uint256 epoch, uint256 amount, bytes32[] calldata proof) external;
    function claimFor(
        address account,
        address token,
        address asset,
        uint256 epoch,
        uint256 amount,
        bytes32[] calldata proof
    ) external;

    function referrerOf(address account) external view returns (address);
    function bindReferrer(address referrer) external;
}
