// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title ReserveVault — On-chain Proof of Reserve
 * @notice Stores records of physical/financial reserves backing INRX, eGold, eSilver.
 *         Custodians add reserve entries with proof (IPFS hash of bank statement/audit).
 *         Anyone can call getBackingRatio() to verify 1:1 backing at any time.
 *
 * @dev This contract does NOT hold actual funds — it records the off-chain reserves.
 *      Actual INR sits in regulated bank accounts.
 *      Actual gold sits in MMTC-PAMP / government vaults.
 *      This contract provides transparent, auditable on-chain records of those reserves.
 *      UUPS upgradeable, role-based access — same pattern as INRX/EGold/ESilver.
 */
contract ReserveVault is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{

    // ─── Roles ────────────────────────────────────────────────────
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
    bytes32 public constant AUDITOR_ROLE   = keccak256("AUDITOR_ROLE");
    bytes32 public constant UPGRADER_ROLE  = keccak256("UPGRADER_ROLE");

    // ─── Asset types ──────────────────────────────────────────────
    enum AssetType {
        INR_BANK_DEPOSIT,   // INR in regulated bank — backs INRX
        GOLD_VAULT,         // Physical gold grams — backs eGold
        SILVER_VAULT,       // Physical silver grams — backs eSilver
        GOVT_SECURITIES,    // T-Bills / Govt bonds — backs INRX
        USDT_COLLATERAL     // Stablecoin collateral — backup
    }

    // ─── Token identifiers ────────────────────────────────────────
    bytes32 public constant TOKEN_INRX  = keccak256("INRX");
    bytes32 public constant TOKEN_EGOLD = keccak256("EGOLD");
    bytes32 public constant TOKEN_ESLVR = keccak256("ESLVR");

    // ─── Reserve Entry ────────────────────────────────────────────
    struct ReserveEntry {
        bytes32   tokenId;          // Which token this backs
        AssetType assetType;        // Type of reserve asset
        uint256   amount;           // Amount (6 decimals, same as token)
        string    custodian;        // Name: "HDFC Bank", "MMTC-PAMP", etc.
        string    proofHash;        // IPFS hash of proof document
        uint256   timestamp;        // When added
        address   addedBy;          // Who added this entry
        bool      active;           // Can be deactivated if asset moves
    }

    // ─── Audit Record ─────────────────────────────────────────────
    struct AuditRecord {
        uint256   timestamp;
        address   auditor;
        string    auditorName;
        bytes32   tokenId;
        uint256   reserveAmount;    // Total reserves at audit time
        uint256   circulatingSupply;// Token supply at audit time
        string    reportHash;       // IPFS hash of full audit report
        string    notes;
    }

    // ─── Token supply interfaces ──────────────────────────────────
    // These point to INRX / EGold / ESilver contracts
    mapping(bytes32 => address) public tokenContracts;

    // ─── Storage ──────────────────────────────────────────────────
    ReserveEntry[] public reserveEntries;
    AuditRecord[]  public auditRecords;

    // ─── Events ───────────────────────────────────────────────────
    event ReserveAdded(
        uint256 indexed entryId,
        bytes32 indexed tokenId,
        AssetType assetType,
        uint256 amount,
        string custodian,
        string proofHash
    );
    event ReserveDeactivated(uint256 indexed entryId, string reason);
    event AuditRecorded(
        uint256 indexed auditId,
        bytes32 indexed tokenId,
        address auditor,
        uint256 reserveAmount,
        uint256 circulatingSupply,
        string reportHash
    );
    event TokenContractSet(bytes32 indexed tokenId, address contractAddress);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address admin) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(CUSTODIAN_ROLE, admin);
        _grantRole(AUDITOR_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    // ─── Token contract registration ──────────────────────────────

    /**
     * @notice Register the token contract address for a token.
     *         Used to read circulating supply for backing ratio calculation.
     */
    function setTokenContract(bytes32 tokenId, address contractAddress)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        tokenContracts[tokenId] = contractAddress;
        emit TokenContractSet(tokenId, contractAddress);
    }

    // ─── Reserve management ───────────────────────────────────────

    /**
     * @notice Add a new reserve entry.
     * @param tokenId   TOKEN_INRX, TOKEN_EGOLD, or TOKEN_ESLVR
     * @param assetType Type of reserve asset
     * @param amount    Amount with 6 decimals (1 INR = 1_000_000)
     * @param custodian Name of custodian ("HDFC Bank Mumbai Branch")
     * @param proofHash IPFS CID of the proof document
     */
    function addReserve(
        bytes32   tokenId,
        AssetType assetType,
        uint256   amount,
        string calldata custodian,
        string calldata proofHash
    ) external onlyRole(CUSTODIAN_ROLE) returns (uint256 entryId) {
        require(amount > 0, "ReserveVault: zero amount");
        require(bytes(custodian).length > 0, "ReserveVault: empty custodian");

        entryId = reserveEntries.length;
        reserveEntries.push(ReserveEntry({
            tokenId:   tokenId,
            assetType: assetType,
            amount:    amount,
            custodian: custodian,
            proofHash: proofHash,
            timestamp: block.timestamp,
            addedBy:   msg.sender,
            active:    true
        }));

        emit ReserveAdded(entryId, tokenId, assetType, amount, custodian, proofHash);
    }

    /**
     * @notice Deactivate a reserve entry (e.g., funds moved to different account).
     */
    function deactivateReserve(uint256 entryId, string calldata reason)
        external onlyRole(CUSTODIAN_ROLE)
    {
        require(entryId < reserveEntries.length, "ReserveVault: invalid id");
        require(reserveEntries[entryId].active, "ReserveVault: already inactive");
        reserveEntries[entryId].active = false;
        emit ReserveDeactivated(entryId, reason);
    }

    // ─── Audit management ─────────────────────────────────────────

    /**
     * @notice Record a formal audit result on-chain.
     * @param tokenId         Which token was audited
     * @param reserveAmount   Total reserves verified by auditor
     * @param reportHash      IPFS CID of the full audit report PDF
     */
    function recordAudit(
        bytes32 tokenId,
        uint256 reserveAmount,
        uint256 circulatingSupply,
        string calldata auditorName,
        string calldata reportHash,
        string calldata notes
    ) external onlyRole(AUDITOR_ROLE) returns (uint256 auditId) {
        auditId = auditRecords.length;
        auditRecords.push(AuditRecord({
            timestamp:         block.timestamp,
            auditor:           msg.sender,
            auditorName:       auditorName,
            tokenId:           tokenId,
            reserveAmount:     reserveAmount,
            circulatingSupply: circulatingSupply,
            reportHash:        reportHash,
            notes:             notes
        }));

        emit AuditRecorded(auditId, tokenId, msg.sender, reserveAmount, circulatingSupply, reportHash);
    }

    // ─── View functions — Proof of Reserve ───────────────────────

    /**
     * @notice Get total active reserves for a specific token.
     *         This is the sum of all active reserve entries for that token.
     */
    function getTotalReserve(bytes32 tokenId) public view returns (uint256 total) {
        for (uint256 i = 0; i < reserveEntries.length; i++) {
            ReserveEntry storage e = reserveEntries[i];
            if (e.active && e.tokenId == tokenId) {
                total += e.amount;
            }
        }
    }

    /**
     * @notice Get the circulating supply of a token by reading its contract.
     *         Falls back to 0 if contract not registered.
     */
    function getCirculatingSupply(bytes32 tokenId) public view returns (uint256) {
        address contractAddr = tokenContracts[tokenId];
        if (contractAddr == address(0)) return 0;
        try ITokenSupply(contractAddr).totalSupply() returns (uint256 supply) {
            return supply;
        } catch {
            return 0;
        }
    }

    /**
     * @notice Get backing ratio as a percentage with 2 decimals.
     *         Example: 10250 = 102.50% backed
     *         Returns 0 if supply is 0 (nothing minted yet).
     *
     * @dev Formula: (totalReserve * 10000) / circulatingSupply
     */
    function getBackingRatio(bytes32 tokenId) external view returns (uint256 ratio) {
        uint256 supply  = getCirculatingSupply(tokenId);
        uint256 reserve = getTotalReserve(tokenId);
        if (supply == 0) return type(uint256).max; // infinite — nothing minted
        ratio = (reserve * 10_000) / supply;
    }

    /**
     * @notice Full proof of reserve snapshot for a token.
     *         Call this to verify the peg at any point in time.
     */
    function getProofOfReserve(bytes32 tokenId)
        external view
        returns (
            uint256 totalReserve,
            uint256 circulatingSupply,
            uint256 backingRatioBps,   // basis points: 10000 = 100%
            bool    isFullyBacked,
            uint256 lastAuditTimestamp,
            string  memory lastAuditReport
        )
    {
        totalReserve       = getTotalReserve(tokenId);
        circulatingSupply  = getCirculatingSupply(tokenId);

        if (circulatingSupply == 0) {
            backingRatioBps = type(uint256).max;
            isFullyBacked   = true;
        } else {
            backingRatioBps = (totalReserve * 10_000) / circulatingSupply;
            isFullyBacked   = backingRatioBps >= 10_000; // >= 100%
        }

        // Find last audit for this token
        for (uint256 i = auditRecords.length; i > 0; i--) {
            if (auditRecords[i-1].tokenId == tokenId) {
                lastAuditTimestamp = auditRecords[i-1].timestamp;
                lastAuditReport    = auditRecords[i-1].reportHash;
                break;
            }
        }
    }

    /**
     * @notice Get all active reserve entries for a token — for transparency dashboards.
     */
    function getActiveReserves(bytes32 tokenId)
        external view
        returns (ReserveEntry[] memory)
    {
        // Count active entries first
        uint256 count = 0;
        for (uint256 i = 0; i < reserveEntries.length; i++) {
            if (reserveEntries[i].active && reserveEntries[i].tokenId == tokenId) count++;
        }

        ReserveEntry[] memory result = new ReserveEntry[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < reserveEntries.length; i++) {
            if (reserveEntries[i].active && reserveEntries[i].tokenId == tokenId) {
                result[idx++] = reserveEntries[i];
            }
        }
        return result;
    }

    /**
     * @notice Get all audit records for a token.
     */
    function getAuditHistory(bytes32 tokenId)
        external view
        returns (AuditRecord[] memory)
    {
        uint256 count = 0;
        for (uint256 i = 0; i < auditRecords.length; i++) {
            if (auditRecords[i].tokenId == tokenId) count++;
        }

        AuditRecord[] memory result = new AuditRecord[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < auditRecords.length; i++) {
            if (auditRecords[i].tokenId == tokenId) {
                result[idx++] = auditRecords[i];
            }
        }
        return result;
    }

    function reserveCount() external view returns (uint256) { return reserveEntries.length; }
    function auditCount()   external view returns (uint256) { return auditRecords.length;   }

    // ─── Upgrade authorization ──────────────────────────────────────

    function _authorizeUpgrade(address newImplementation)
        internal override onlyRole(UPGRADER_ROLE) {}

    uint256[50] private __gap;
}

interface ITokenSupply {
    function totalSupply() external view returns (uint256);
}
