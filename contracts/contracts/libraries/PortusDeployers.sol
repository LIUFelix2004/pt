// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LaunchToken} from "../LaunchToken.sol";
import {PortusPool} from "../PortusPool.sol";
import {PortusSale} from "../PortusSale.sol";
import {PortusTreasury} from "../PortusTreasury.sol";
import {PortusMintToken} from "../PortusMintToken.sol";
import {PortusTaxPool} from "../PortusTaxPool.sol";
import {PortusEmission} from "../PortusEmission.sol";
import {SaleConfig, MintTax, MintSchedule} from "../interfaces/PortusTypes.sol";

// Linked external libraries that hold the creation code of each per-launch
// contract. Inlining them into PortusFactory would push it past the 24 KB
// runtime limit (EIP-170).
//
// External library calls are DELEGATECALLs, so each `new` below executes in the
// Factory's context: the Factory is the creator, `address(this)` is the Factory
// and the new contract sees `msg.sender == factory`. No initializer or admin
// wiring is needed, and calling a library directly is rejected by Solidity's
// library call protection.

library TokenDeployer {
    function deploy(string calldata name, string calldata symbol, uint256 supply) external returns (address) {
        return address(new LaunchToken(name, symbol, supply, address(this)));
    }
}

library PoolDeployer {
    function deploy(address token, address quoteAsset, uint16 feeBps, address locker, address feeSplitter)
        external
        returns (address)
    {
        return address(new PortusPool(address(this), token, quoteAsset, feeBps, locker, feeSplitter));
    }
}

library SaleDeployer {
    function deploy(SaleConfig calldata config) external returns (address) {
        return address(new PortusSale(config));
    }
}

library TreasuryDeployer {
    function deploy(address token, address quoteAsset, address pool, address distributor, uint8 mode)
        external
        returns (address)
    {
        return address(new PortusTreasury(token, quoteAsset, pool, distributor, mode));
    }
}

library MintTokenDeployer {
    function deploy(string calldata name, string calldata symbol, uint256 initialSupply, uint256 maxSupply)
        external
        returns (address)
    {
        return address(new PortusMintToken(name, symbol, initialSupply, maxSupply, address(this)));
    }
}

library TaxPoolDeployer {
    function deploy(address token, address quoteAsset, MintTax calldata tax) external returns (address) {
        return address(new PortusTaxPool(address(this), token, quoteAsset, tax));
    }
}

library EmissionDeployer {
    function deploy(
        address token,
        address distributor,
        uint256 initialSupply,
        uint256 maxSupply,
        uint16 staticBps,
        MintSchedule calldata schedule
    ) external returns (address) {
        return address(new PortusEmission(token, distributor, initialSupply, maxSupply, staticBps, schedule));
    }
}
