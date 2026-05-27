// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title eGold — Gold-backed token
 * @notice 1 EGOLD = 1 gram of gold
 */
contract EGold is
    Initializable,
    ERC20Upgradeable,
    ERC20PausableUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE   = keccak256("BURNER_ROLE");
    bytes32 public constant FREEZER_ROLE  = keccak256("FREEZER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    mapping(address => bool) private _blacklisted;
    mapping(address => bool) private _frozen;

    // Gold price feed (updated by oracle)
    uint256 public goldPricePerGram; // in INR, 6 decimals
    address public priceOracle;

    event Mint(address indexed to, uint256 grams, uint256 priceAtMint);
    event Burn(address indexed from, uint256 grams);
    event GoldPriceUpdated(uint256 newPrice);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address admin,
        address minter,
        uint256 initialGoldPrice
    ) public initializer {
        __ERC20_init("eGold Token", "EGOLD");
        __ERC20Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(UPGRADER_ROLE, admin);

        goldPricePerGram = initialGoldPrice;
        priceOracle = admin;
    }

    function mint(address to, uint256 grams) external onlyRole(MINTER_ROLE) {
        require(!_blacklisted[to], "EGold: blacklisted");
        _mint(to, grams);
        emit Mint(to, grams, goldPricePerGram);
    }

    function burn(address from, uint256 grams) external onlyRole(BURNER_ROLE) {
        _burn(from, grams);
        emit Burn(from, grams);
    }

    function updateGoldPrice(uint256 newPrice) external {
        require(msg.sender == priceOracle, "EGold: not oracle");
        goldPricePerGram = newPrice;
        emit GoldPriceUpdated(newPrice);
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
        require(!_blacklisted[from] && !_frozen[from], "EGold: restricted");
    }

    if (to != address(0)) {
        require(!_blacklisted[to], "EGold: restricted");
    }

    super._beforeTokenTransfer(from, to, amount);
}

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
    function decimals() public pure override returns (uint8) { return 6; }
}