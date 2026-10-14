// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Placeholder incentive pool. Phase 1 has no withdrawal path, so it is
/// local/testnet only; the Distributor phase replaces it with a new Factory.
interface IIncentiveVault {
    event SaleRegistered(address indexed sale, address indexed token);
    event IncentiveFunded(address indexed token, uint256 amount);

    error NotFactory();
    error UnknownSale();
    error FundingMismatch();

    function factory() external view returns (address);
    function tokenOfSale(address sale) external view returns (address);
    function funded(address token) external view returns (uint256);

    function registerSale(address sale, address token) external;
    function notifyFunded(uint256 amount) external;
}
