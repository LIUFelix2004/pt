// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Four-way fee split, fixed per pool at creation: ecosystem 20%,
/// flywheel 20%, creator c ∈ [0, 40%], treasury the remainder (60% − c).
interface IPortusFeeSplitter {
    event PoolRegistered(
        address indexed pool, address indexed token, address quoteAsset, address creator, uint16 creatorBps, address treasury
    );
    event FeeSplit(
        address indexed token, address indexed quoteAsset, uint256 ecosystem, uint256 flywheel, uint256 creator, uint256 treasury
    );
    event FeeClaimed(address indexed account, address indexed quoteAsset, uint256 amount, address indexed to);

    error NotFactory();
    error UnknownPool();
    error FeeNotReceived();
    error NothingToClaim();

    function ECOSYSTEM_BPS() external view returns (uint16);
    function FLYWHEEL_BPS() external view returns (uint16);
    function factory() external view returns (address);
    function ecosystem() external view returns (address);
    function flywheel() external view returns (address);
    function owed(address quoteAsset, address account) external view returns (uint256);
    function shares(address token)
        external
        view
        returns (uint16 ecosystemBps, uint16 flywheelBps, uint16 creatorBps, uint16 treasuryBps);

    function registerPool(
        address pool,
        address token,
        address quoteAsset,
        address creator,
        uint16 creatorBps,
        address treasury
    ) external;
    function onFee(uint256 amount) external;
    function claim(address quoteAsset) external returns (uint256 amount);
    function claimFor(address account, address quoteAsset) external returns (uint256 amount);
}
