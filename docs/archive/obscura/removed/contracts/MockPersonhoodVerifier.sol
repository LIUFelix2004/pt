// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPersonhoodVerifier} from "./IPersonhoodVerifier.sol";

/// @notice Test-only verifier. Production deployments must use an audited adapter.
contract MockPersonhoodVerifier is IPersonhoodVerifier {
    mapping(address => bool) public verified;

    function setVerified(address account, bool value) external {
        verified[account] = value;
    }

    function verify(address account, bytes calldata proof) external view returns (bool) {
        return proof.length > 0 && verified[account];
    }
}
