// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice Mint-mode launch token. The initial supply is minted once, to the
/// Factory, which hands it to the Sale in the same transaction. After that only
/// the launch's Emission contract can mint, on its fixed schedule, and never
/// past `maxSupply` cumulatively (burns do not free up room).
///
/// No owner, no pause, no blacklist, no transfer tax (the trading tax lives in
/// the pool, so wallet-to-wallet transfers are untaxed).
contract PortusMintToken is ERC20, ERC20Burnable {
    address public immutable factory;
    uint256 public immutable maxSupply;

    address public minter;
    /// @notice Everything ever minted, including the initial supply.
    uint256 public totalMinted;

    error NotFactory();
    error NotMinter();
    error MinterAlreadySet();
    error CapExceeded();

    constructor(string memory name_, string memory symbol_, uint256 initialSupply_, uint256 maxSupply_, address recipient_)
        ERC20(name_, symbol_)
    {
        factory = msg.sender;
        maxSupply = maxSupply_;
        totalMinted = initialSupply_;
        _mint(recipient_, initialSupply_);
    }

    /// @notice Wired once by the Factory inside the creating transaction.
    function setMinter(address minter_) external {
        if (msg.sender != factory) revert NotFactory();
        if (minter != address(0)) revert MinterAlreadySet();
        minter = minter_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter || minter == address(0)) revert NotMinter();
        uint256 total = totalMinted + amount;
        if (total > maxSupply) revert CapExceeded();
        totalMinted = total;
        _mint(to, amount);
    }
}
