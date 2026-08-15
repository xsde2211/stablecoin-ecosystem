// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title EcosystemProxy
 * @notice Thin re-export of OpenZeppelin's ERC1967Proxy so TronBox's
 *         directory-scan compiler (scripts/compile.js walks every .sol file
 *         in contracts/) produces a build artifact for it.
 *
 * @dev Every upgradeable contract in this repo (INRX/EGold/ESilver,
 *      OracleManager, ReserveVault, TreasuryTimelock, TronBridge) gets
 *      deployed behind one of these, with `initialize(...)` encoded as the
 *      `data` constructor argument — the proxy's own constructor performs
 *      a delegatecall into the implementation's initialize() as part of
 *      the SAME deployment transaction, so there is no window between
 *      "contract exists" and "contract is initialized" for anyone to
 *      exploit or accidentally miss.
 */
contract EcosystemProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory data)
        ERC1967Proxy(implementation, data)
    {}
}
