// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// TEST-ONLY quote assets. deploy.ts registers MockWETH / MockERC20 on local
// chains only; none of these may reach a public network.

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Freely mintable ERC-20 with configurable decimals (stand-in for USD-like assets).
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Minimal WETH9: deposit / withdraw plus a test mint.
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        payable(msg.sender).transfer(amount);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}

/// @notice Takes a 1% cut on every transfer, so the receiver sees less than `amount`.
contract MockFeeOnTransferERC20 is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 cut = value / 100;
            super._update(from, address(0xdead), cut);
            value -= cut;
        }
        super._update(from, to, value);
    }
}

/// @notice Balances that can be rescaled by anyone, to model rebasing assets.
contract MockRebasingERC20 is ERC20 {
    uint256 public bonusBps;

    constructor() ERC20("Rebase Token", "RBT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// Every incoming transfer is credited with an extra bonusBps, minted from nothing.
    function setBonusBps(uint256 bps) external {
        bonusBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to != address(0) && bonusBps > 0) {
            super._update(address(0), to, (value * bonusBps) / 10_000);
        }
    }
}

interface IReentryTarget {
    function claim() external returns (uint256, uint256);
    function finalize() external;
    function buy(uint256, uint256, address, uint256) external returns (uint256);
}

/// @notice Calls back into a target from inside `transfer`/`transferFrom`, the
/// way an ERC-777-style hook would. The nested call must revert.
contract MockReentrantERC20 is ERC20 {
    enum Attack {
        NONE,
        CLAIM,
        FINALIZE,
        BUY
    }

    address public target;
    Attack public attack;
    bool public reentered;
    bool public reentrySucceeded;

    constructor() ERC20("Reentrant", "RENT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, Attack attack_) external {
        target = target_;
        attack = attack_;
        reentered = false;
        reentrySucceeded = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (attack == Attack.NONE || reentered || from == address(0) || to == address(0)) return;
        reentered = true;
        bool ok;
        if (attack == Attack.CLAIM) {
            (ok,) = target.call(abi.encodeCall(IReentryTarget.claim, ()));
        } else if (attack == Attack.FINALIZE) {
            (ok,) = target.call(abi.encodeCall(IReentryTarget.finalize, ()));
        } else {
            (ok,) = target.call(abi.encodeCall(IReentryTarget.buy, (1, 0, address(this), type(uint256).max)));
        }
        reentrySucceeded = ok;
    }
}

/// @notice TESTNET ONLY. Wrapped-ether stand-in that anyone can mint (capped per call)
///         so testers can subscribe without bridging. Not backed 1:1, has no withdraw.
contract TestWETH is ERC20 {
    uint256 public constant MAX_MINT = 10 ether;

    error MintTooLarge();

    constructor() ERC20("Test Wrapped Ether (Portus testnet)", "tWETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintTooLarge();
        _mint(to, amount);
    }
}
