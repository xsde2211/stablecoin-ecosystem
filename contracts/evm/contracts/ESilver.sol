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
    bytes32 public constant FREEZER_ROLE     = keccak256("FREEZER_ROLE");
    bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");
    bytes32 public constant TREASURY_ROLE    = keccak256("TREASURY_ROLE");

    mapping(address => bool) private _frozen;
    mapping(address => bool) private _blacklisted;

    uint256 public silverPricePerGram; // in INR, 6 decimals
    address public priceOracle;
    uint256 public mintCap;
    uint256 public totalMinted;
    uint256 public totalBurned;

    event Mint(address indexed to, uint256 grams, uint256 priceAtMint, string indexed reason);
    event Burn(address indexed from, uint256 grams, string indexed reason);
    event Blacklisted(address indexed account, bool status);
    event AddressFrozen(address indexed account, bool status);
    event MintCapUpdated(uint256 newCap);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address admin,
        address minter,
        address treasury,
        uint256 _mintCap,
        uint256 initialSilverPrice
    ) public initializer {
        __ERC20_init("eSilver Token", "ESLVR");
        __ERC20Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
        _grantRole(TREASURY_ROLE, treasury);
        _grantRole(UPGRADER_ROLE, admin);
        mintCap = _mintCap;

        silverPricePerGram = initialSilverPrice;
        priceOracle = admin;
    }

    function mint(address to, uint256 grams,string calldata reason) external onlyRole(MINTER_ROLE) {
        require(!_blacklisted[to], "ESilver: blacklisted");
        require(totalSupply() + grams <= mintCap, "ESilver: mint cap exceeded");
        totalMinted += grams; 
        _mint(to, grams);
        emit Mint(to, grams, silverPricePerGram, reason);
    }

    function burn(address from, uint256 grams,string calldata reason) external onlyRole(BURNER_ROLE) {
        totalBurned += grams;              
        _burn(from, grams);
        emit Burn(from, grams,reason);
    }

    function burnFrom(uint256 grams, string calldata reason) external {
        totalBurned += grams;
        _burn(msg.sender, grams);
        emit Burn(msg.sender, grams, reason);
    }
    
    function updateSilverPrice(uint256 newPrice) external {
        require(msg.sender == priceOracle, "ESilver: not oracle");
        silverPricePerGram = newPrice;
    }

    function blacklist(address account, bool status)external onlyRole(BLACKLISTER_ROLE){
        _blacklisted[account] = status;
        emit Blacklisted(account, status);
    }

    function freeze(address account, bool status) external onlyRole(FREEZER_ROLE){
        _frozen[account] = status;
        emit AddressFrozen(account, status);
    }

    function setMintCap(uint256 newCap) external onlyRole(TREASURY_ROLE){
        mintCap = newCap;
        emit MintCapUpdated(newCap);
    }

    function isBlacklisted(address a) external view returns (bool){
        return _blacklisted[a];
    }

    function isFrozen(address a) external view returns (bool){
        return _frozen[a];
    }

    function circulatingSupply() external view returns (uint256) { return totalMinted - totalBurned; }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function _beforeTokenTransfer(address from,address to,uint256 amount) internal
    override(ERC20Upgradeable, ERC20PausableUpgradeable){
        if (from != address(0)) {
            require(!_blacklisted[from], "ESilver: restricted");
            require(!_frozen[from], "ESilver: sender frozen");
        }

        if (to != address(0)) {
            require(!_blacklisted[to], "ESilver: restricted");
        }
        super._beforeTokenTransfer(from, to, amount);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
    function decimals() public pure override returns (uint8) { return 6; }
}