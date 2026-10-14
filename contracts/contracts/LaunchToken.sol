// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice Portus launch token. The whole fixed supply is minted once, to the
/// Factory, which hands all of it to the Sale in the same transaction.
///
/// No owner, no mint, no pause, no blacklist, no transfer tax: totalSupply can
/// only ever go down.
contract LaunchToken is ERC20, ERC20Burnable {
    constructor(string memory name_, string memory symbol_, uint256 totalSupply_, address recipient_)
        ERC20(name_, symbol_)
    {
        _mint(recipient_, totalSupply_);
    }
}
