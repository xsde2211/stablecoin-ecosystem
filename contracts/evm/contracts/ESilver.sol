// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title eSilver — Silver-backed token
 * @notice 1 ESLVR = 1 gram of silver
 */
contract ESilver is
    Initializable,
    ERC20Upgradeable,
    ERC20PausableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE   = keccak256("BURNER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    mapping(address => bool) private _blacklisted;

    uint256 public silverPricePerGram; // in INR, 6 decimals
    address public priceOracle;

    event Mint(address indexed to, uint256 grams, uint256 priceAtMint);
    event Burn(address indexed from, uint256 grams);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address admin,
        address minter,
        uint256 initialSilverPrice
    ) public initializer {
        __ERC20_init("eSilver Token", "ESLVR");
        __ERC20Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(UPGRADER_ROLE, admin);

        silverPricePerGram = initialSilverPrice;
        priceOracle = admin;
    }

    function mint(address to, uint256 grams) external onlyRole(MINTER_ROLE) {
        require(!_blacklisted[to], "ESilver: blacklisted");
        _mint(to, grams);
        emit Mint(to, grams, silverPricePerGram);
    }

    function burn(address from, uint256 grams) external onlyRole(BURNER_ROLE) {
        _burn(from, grams);
        emit Burn(from, grams);
    }

    function updateSilverPrice(uint256 newPrice) external {
        require(msg.sender == priceOracle, "ESilver: not oracle");
        silverPricePerGram = newPrice;
    }

    function blacklist(address account, bool status)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _blacklisted[account] = status;
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _beforeTokenTransfer(
    address from,
    address to,
    uint256 amount
)
    internal
    override(ERC20Upgradeable, ERC20PausableUpgradeable)
{
    if (from != address(0)) {
        require(!_blacklisted[from], "ESilver: restricted");
    }

    if (to != address(0)) {
        require(!_blacklisted[to], "ESilver: restricted");
    }

    super._beforeTokenTransfer(from, to, amount);
}

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
    function decimals() public pure override returns (uint8) { return 6; }
}