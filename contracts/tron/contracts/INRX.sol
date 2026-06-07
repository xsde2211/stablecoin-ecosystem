// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title INRX — INR-backed stablecoin (e₹)
 * @notice 1 INRX = 1 INR. Fully reserve-backed.
 * @dev UUPS upgradeable, role-based access, blacklist, freeze-per-address
 */
contract INRX is
    Initializable,
    ERC20Upgradeable,
    ERC20PausableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE   = keccak256("BURNER_ROLE");
    bytes32 public constant FREEZER_ROLE  = keccak256("FREEZER_ROLE");
    bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    mapping(address => bool) private _blacklisted;
    mapping(address => bool) private _frozen;

    uint256 public mintCap;           // Maximum mintable supply
    uint256 public totalMinted;
    uint256 public totalBurned;

    event Blacklisted(address indexed account, bool status);
    event AddressFrozen(address indexed account, bool status);
    event MintCapUpdated(uint256 newCap);
    event Mint(address indexed to, uint256 amount, string indexed reason);
    event Burn(address indexed from, uint256 amount, string indexed reason);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address defaultAdmin,
        address minter,
        address treasury,
        uint256 _mintCap
    ) public initializer {
        __ERC20_init("e-Rupee Stablecoin", "INRX");
        __ERC20Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(TREASURY_ROLE, treasury);
        _grantRole(UPGRADER_ROLE, defaultAdmin);

        mintCap = _mintCap;
    }

    // ─── Mint / Burn ──────────────────────────────────────────────

    function mint(
        address to,
        uint256 amount,
        string calldata reason
    ) external onlyRole(MINTER_ROLE) {
        require(!_blacklisted[to], "INRX: recipient blacklisted");
        require(!_frozen[to], "INRX: recipient frozen");
        require(totalMinted + amount <= mintCap, "INRX: mint cap exceeded");

        totalMinted += amount;
        _mint(to, amount);
        emit Mint(to, amount, reason);
    }

    function burn(
        address from,
        uint256 amount,
        string calldata reason
    ) external onlyRole(BURNER_ROLE) {
        totalBurned += amount;
        _burn(from, amount);
        emit Burn(from, amount, reason);
    }

    function burnFrom(uint256 amount, string calldata reason) external {
        totalBurned += amount;
        _burn(msg.sender, amount);
        emit Burn(msg.sender, amount, reason);
    }

    // ─── Compliance controls ──────────────────────────────────────

    function blacklist(address account, bool status)
        external onlyRole(BLACKLISTER_ROLE)
    {
        _blacklisted[account] = status;
        emit Blacklisted(account, status);
    }

    function freeze(address account, bool status)
        external onlyRole(FREEZER_ROLE)
    {
        _frozen[account] = status;
        emit AddressFrozen(account, status);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function setMintCap(uint256 newCap) external onlyRole(TREASURY_ROLE) {
        mintCap = newCap;
        emit MintCapUpdated(newCap);
    }

    // ─── View helpers ─────────────────────────────────────────────

    function isBlacklisted(address a) external view returns (bool) { return _blacklisted[a]; }
    function isFrozen(address a)      external view returns (bool) { return _frozen[a]; }
    function circulatingSupply()      external view returns (uint256) { return totalMinted - totalBurned; }

    // ─── Transfer guard ───────────────────────────────────────────

    function _beforeTokenTransfer(
    address from,
    address to,
    uint256 amount
)
    internal
    override(ERC20Upgradeable, ERC20PausableUpgradeable)
{
    if (from != address(0)) {
        require(!_blacklisted[from], "INRX: sender blacklisted");
        require(!_frozen[from], "INRX: sender frozen");
    }

    if (to != address(0)) {
        require(!_blacklisted[to], "INRX: recipient blacklisted");
    }

    super._beforeTokenTransfer(from, to, amount);
}

    function _authorizeUpgrade(address newImpl)
        internal override onlyRole(UPGRADER_ROLE) {}

    function decimals() public pure override returns (uint8) { return 6; }
}