// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Pluggable proof-of-personhood adapter used by AgentRegistry.
interface IPersonhoodVerifier {
    function verify(address account, bytes calldata proof) external view returns (bool);
}
