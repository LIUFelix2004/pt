// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice The one integer helper OpenZeppelin's Math does not ship.
/// mulDiv and sqrt come straight from OZ.
library PortusMath {
    function gcd(uint256 a, uint256 b) internal pure returns (uint256) {
        while (b != 0) {
            (a, b) = (b, a % b);
        }
        return a;
    }

    /// @notice ceil(a * b / d) for small operands where a * b cannot overflow (fees).
    function mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        uint256 p = a * b;
        return p == 0 ? 0 : (p - 1) / d + 1;
    }
}
