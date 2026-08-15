// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title OracleManager — Multi-oracle price management for eGold and eSilver
 * @notice Manages multiple price oracles with median aggregation and staleness checks.
 *         If any single oracle fails or is compromised, the median of others is used.
 *
 * @dev eGold and eSilver use this contract instead of a single priceOracle address.
 *      The token contracts call OracleManager.getPrice(tokenId) to get current price.
 *      UUPS upgradeable, role-based access — same pattern as INRX/EGold/ESilver.
 */
contract OracleManager is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant ORACLE_ROLE   = keccak256("ORACLE_ROLE");
    bytes32 public constant MANAGER_ROLE  = keccak256("MANAGER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // Token identifiers — must match what token contracts use
    bytes32 public constant TOKEN_EGOLD = keccak256("EGOLD");
    bytes32 public constant TOKEN_ESLVR = keccak256("ESLVR");
    bytes32 public constant TOKEN_INRX  = keccak256("INRX");  // INR/USD if needed

    // How old a price can be before considered stale (default 24 hours)
    uint256 public stalePriceThreshold;

    // ─── Oracle data ──────────────────────────────────────────────
    struct OracleData {
        string  name;          // "Chainlink", "Band Protocol", "Manual"
        uint256 price;         // Price in INR with 6 decimals (1 INR = 1_000_000)
        uint256 updatedAt;     // Last update timestamp
        bool    active;
    }

    // tokenId → oracle address → OracleData
    mapping(bytes32 => mapping(address => OracleData)) public oracleData;

    // tokenId → list of registered oracle addresses
    mapping(bytes32 => address[]) public oracleList;

    // tokenId → is oracle registered
    mapping(bytes32 => mapping(address => bool)) public isRegistered;

    // Minimum number of oracles required for a valid price
    uint256 public minOracles;

    // ─── Events ───────────────────────────────────────────────────
    event OracleRegistered(bytes32 indexed tokenId, address indexed oracle, string name);
    event OracleRemoved(bytes32 indexed tokenId, address indexed oracle);
    event PriceUpdated(bytes32 indexed tokenId, address indexed oracle, uint256 price, uint256 timestamp);
    event StalePriceThresholdUpdated(uint256 newThreshold);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        stalePriceThreshold = 24 hours;
        minOracles = 1;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    // ─── Oracle management ────────────────────────────────────────

    /**
     * @notice Register a new price oracle for a token.
     * @param tokenId  keccak256("EGOLD") or keccak256("ESLVR")
     * @param oracle   Oracle's address (the wallet that will call updatePrice)
     * @param name     Human-readable name for the oracle
     */
    function registerOracle(
        bytes32 tokenId,
        address oracle,
        string calldata name
    ) external onlyRole(MANAGER_ROLE) {
        require(oracle != address(0),               "Oracle: zero address");
        require(!isRegistered[tokenId][oracle],     "Oracle: already registered");

        isRegistered[tokenId][oracle] = true;
        oracleList[tokenId].push(oracle);
        oracleData[tokenId][oracle] = OracleData({
            name:      name,
            price:     0,
            updatedAt: 0,
            active:    true
        });

        _grantRole(ORACLE_ROLE, oracle);
        emit OracleRegistered(tokenId, oracle, name);
    }

    /**
     * @notice Deactivate an oracle — its price won't be used in aggregation.
     */
    function deactivateOracle(bytes32 tokenId, address oracle)
        external onlyRole(MANAGER_ROLE)
    {
        require(isRegistered[tokenId][oracle], "Oracle: not registered");
        oracleData[tokenId][oracle].active = false;
        emit OracleRemoved(tokenId, oracle);
    }

    function reactivateOracle(bytes32 tokenId, address oracle)
        external onlyRole(MANAGER_ROLE)
    {
        require(isRegistered[tokenId][oracle], "Oracle: not registered");
        oracleData[tokenId][oracle].active = true;
    }

    // ─── Price updates ────────────────────────────────────────────

    /**
     * @notice Oracle submits a price update.
     * @param tokenId  Which token's price is being updated
     * @param price    Price in INR with 6 decimals
     *                 Example: gold at ₹5,900/gram → 5_900_000_000 (5900 * 10^6)
     */
    function updatePrice(bytes32 tokenId, uint256 price)
        external onlyRole(ORACLE_ROLE)
    {
        require(isRegistered[tokenId][msg.sender], "Oracle: not registered for token");
        require(oracleData[tokenId][msg.sender].active, "Oracle: deactivated");
        require(price > 0, "Oracle: zero price");

        oracleData[tokenId][msg.sender].price     = price;
        oracleData[tokenId][msg.sender].updatedAt = block.timestamp;

        emit PriceUpdated(tokenId, msg.sender, price, block.timestamp);
    }

    /**
     * @notice Admin can manually set price (for testing or emergency).
     */
    function setManualPrice(bytes32 tokenId, address oracle, uint256 price)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(isRegistered[tokenId][oracle], "Oracle: not registered");
        oracleData[tokenId][oracle].price     = price;
        oracleData[tokenId][oracle].updatedAt = block.timestamp;
        emit PriceUpdated(tokenId, oracle, price, block.timestamp);
    }

    // ─── Price reading — median aggregation ───────────────────────

    /**
     * @notice Get the aggregated (median) price for a token.
     *         Only uses active, non-stale oracle prices.
     *         Reverts if not enough valid prices available.
     */
    function getPrice(bytes32 tokenId)
        external view
        returns (uint256 medianPrice, uint256 validOracleCount)
    {
        (medianPrice, validOracleCount) = _aggregatePrice(tokenId);
        require(validOracleCount >= minOracles, "Oracle: insufficient valid prices");
    }

    /**
     * @notice Get price without reverting — returns (0, 0) if no valid prices.
     *         Use this in views/checks where you don't want to revert.
     */
    function getPriceSafe(bytes32 tokenId)
        external view
        returns (uint256 medianPrice, uint256 validOracleCount)
    {
        return _aggregatePrice(tokenId);
    }

    function _aggregatePrice(bytes32 tokenId)
        internal view
        returns (uint256 medianPrice, uint256 count)
    {
        address[] storage oracles = oracleList[tokenId];
        uint256[] memory prices   = new uint256[](oracles.length);

        for (uint i = 0; i < oracles.length; i++) {
            OracleData storage od = oracleData[tokenId][oracles[i]];
            if (!od.active) continue;
            if (od.updatedAt == 0) continue;
            if (block.timestamp - od.updatedAt > stalePriceThreshold) continue;
            if (od.price == 0) continue;
            prices[count++] = od.price;
        }

        if (count == 0) return (0, 0);

        // Sort prices (insertion sort — fine for small arrays)
        uint256[] memory valid = new uint256[](count);
        for (uint i = 0; i < count; i++) valid[i] = prices[i];

        for (uint i = 1; i < count; i++) {
            uint256 key = valid[i];
            uint256 j   = i;
            while (j > 0 && valid[j-1] > key) {
                valid[j] = valid[j-1];
                j--;
            }
            valid[j] = key;
        }

        // Median
        if (count % 2 == 1) {
            medianPrice = valid[count / 2];
        } else {
            medianPrice = (valid[count/2 - 1] + valid[count/2]) / 2;
        }
    }

    // ─── Views ────────────────────────────────────────────────────

    /**
     * @notice Get all oracles for a token with their current data.
     */
    function getOracles(bytes32 tokenId)
        external view
        returns (
            address[] memory addresses,
            string[]  memory names,
            uint256[] memory prices,
            uint256[] memory updatedAts,
            bool[]    memory actives,
            bool[]    memory stales
        )
    {
        address[] storage list = oracleList[tokenId];
        uint256 n = list.length;

        addresses  = new address[](n);
        names      = new string[](n);
        prices     = new uint256[](n);
        updatedAts = new uint256[](n);
        actives    = new bool[](n);
        stales     = new bool[](n);

        for (uint i = 0; i < n; i++) {
            OracleData storage od = oracleData[tokenId][list[i]];
            addresses[i]  = list[i];
            names[i]      = od.name;
            prices[i]     = od.price;
            updatedAts[i] = od.updatedAt;
            actives[i]    = od.active;
            stales[i]     = od.updatedAt > 0 &&
                            block.timestamp - od.updatedAt > stalePriceThreshold;
        }
    }

    function isStale(bytes32 tokenId, address oracle) external view returns (bool) {
        OracleData storage od = oracleData[tokenId][oracle];
        return od.updatedAt == 0 ||
               block.timestamp - od.updatedAt > stalePriceThreshold;
    }

    function setStalePriceThreshold(uint256 threshold)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(threshold >= 1 hours, "Oracle: threshold too low");
        stalePriceThreshold = threshold;
        emit StalePriceThresholdUpdated(threshold);
    }

    function setMinOracles(uint256 min) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(min > 0, "Oracle: min must be > 0");
        minOracles = min;
    }

    // ─── Upgrade authorization ──────────────────────────────────────

    function _authorizeUpgrade(address newImplementation)
        internal override onlyRole(UPGRADER_ROLE) {}

    // Reserved storage slots for future upgrades — lets you add new state
    // variables in a later version without shifting existing storage slots.
    uint256[50] private __gap;
}
