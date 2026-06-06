// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IStablecoinFull {
    function mint(address to, uint256 amount, string calldata reason) external;
    function burn(address from, uint256 amount, string calldata reason) external;
    function pause() external;
    function unpause() external;
}

/**
 * @title TreasuryTimelock — Multi-sig + Timelock controlled mint/burn gate
 * @notice M-of-N signers approve → 12 hour delay → anyone can execute.
 *         The delay window allows detection and cancellation of malicious operations.
 *
 * @dev Replaces the old Treasury.sol which executed instantly on M-of-N approval.
 *      Key improvement: even if M signers are compromised, you have 12h to cancel.
 */
contract TreasuryTimelock is AccessControl, ReentrancyGuard {

    // ─── Roles ────────────────────────────────────────────────────
    bytes32 public constant SIGNER_ROLE    = keccak256("SIGNER_ROLE");
    bytes32 public constant GUARDIAN_ROLE  = keccak256("GUARDIAN_ROLE"); // can cancel any op

    // ─── Config ───────────────────────────────────────────────────
    uint256 public requiredSignatures;
    uint256 public timelockDelay;        // seconds — default 12 hours
    uint256 public constant MIN_DELAY = 1 hours;
    uint256 public constant MAX_DELAY = 7 days;
    uint256 public constant EXPIRY    = 72 hours; // op expires if not executed

    // ─── Token registry ───────────────────────────────────────────
    // Supports multiple tokens: INRX, EGOLD, ESLVR
    mapping(bytes32 => address) public tokenContracts;

    // ─── Operation ────────────────────────────────────────────────
    enum OpType   { MINT, BURN, PAUSE, UNPAUSE }
    enum OpStatus { PENDING, APPROVED, QUEUED, EXECUTED, CANCELLED, EXPIRED }

    struct Operation {
        bytes32   tokenId;
        OpType    opType;
        address   target;
        uint256   amount;
        string    reason;
        uint256   approvals;
        OpStatus  status;
        uint256   createdAt;
        uint256   queuedAt;     // set when approvals reach threshold
        uint256   executeAfter; // queuedAt + timelockDelay
        mapping(address => bool) hasSigned;
    }

    uint256 public opCount;
    mapping(uint256 => Operation) public operations;

    // ─── Daily mint limits ────────────────────────────────────────
    mapping(bytes32 => uint256) public dailyMintLimit;   // per token
    mapping(bytes32 => uint256) public dailyMintedToday; // per token
    mapping(bytes32 => uint256) public lastMintDay;       // per token

    // ─── Events ───────────────────────────────────────────────────
    event OperationProposed(
        uint256 indexed opId,
        bytes32 indexed tokenId,
        OpType opType,
        address target,
        uint256 amount,
        address proposer
    );
    event OperationSigned(uint256 indexed opId, address signer, uint256 approvals);
    event OperationQueued(uint256 indexed opId, uint256 executeAfter);
    event OperationExecuted(uint256 indexed opId, address executor);
    event OperationCancelled(uint256 indexed opId, address cancelledBy, string reason);
    event TokenRegistered(bytes32 indexed tokenId, address contractAddress);
    event TimelockDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event DailyLimitUpdated(bytes32 indexed tokenId, uint256 newLimit);

    // ─── Constructor ──────────────────────────────────────────────
    constructor(
        address[] memory signers,
        uint256   _required,
        uint256   _timelockDelay,
        address   guardian
    ) {
        require(_required > 0 && _required <= signers.length, "Timelock: invalid threshold");
        require(_timelockDelay >= MIN_DELAY && _timelockDelay <= MAX_DELAY, "Timelock: invalid delay");

        requiredSignatures = _required;
        timelockDelay      = _timelockDelay;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(GUARDIAN_ROLE, guardian);
        _grantRole(GUARDIAN_ROLE, msg.sender);

        for (uint i = 0; i < signers.length; i++) {
            _grantRole(SIGNER_ROLE, signers[i]);
        }
    }

    // ─── Token registration ───────────────────────────────────────

    function registerToken(bytes32 tokenId, address contractAddress)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        tokenContracts[tokenId] = contractAddress;
        emit TokenRegistered(tokenId, contractAddress);
    }

    // ─── Propose ──────────────────────────────────────────────────

    /**
     * @notice Any signer can propose an operation.
     *         Operation stays PENDING until it collects enough signatures.
     */
    function propose(
        bytes32  tokenId,
        OpType   opType,
        address  target,
        uint256  amount,
        string calldata reason
    ) external onlyRole(SIGNER_ROLE) returns (uint256 opId) {
        require(tokenContracts[tokenId] != address(0), "Timelock: token not registered");

        if (opType == OpType.MINT || opType == OpType.BURN) {
            require(amount > 0, "Timelock: zero amount");
        }

        opId = opCount++;
        Operation storage op = operations[opId];
        op.tokenId    = tokenId;
        op.opType     = opType;
        op.target     = target;
        op.amount     = amount;
        op.reason     = reason;
        op.status     = OpStatus.PENDING;
        op.createdAt  = block.timestamp;

        emit OperationProposed(opId, tokenId, opType, target, amount, msg.sender);

        // Proposer auto-signs
        _sign(opId, msg.sender);
    }

    // ─── Sign ─────────────────────────────────────────────────────

    /**
     * @notice Add your signature to a pending operation.
     *         When threshold is reached, operation enters the timelock queue.
     */
    function sign(uint256 opId) external onlyRole(SIGNER_ROLE) nonReentrant {
        _sign(opId, msg.sender);
    }

    function _sign(uint256 opId, address signer) internal {
        Operation storage op = operations[opId];
        require(op.status == OpStatus.PENDING, "Timelock: not pending");
        require(block.timestamp <= op.createdAt + EXPIRY, "Timelock: expired");
        require(!op.hasSigned[signer], "Timelock: already signed");

        op.hasSigned[signer] = true;
        op.approvals++;
        emit OperationSigned(opId, signer, op.approvals);

        // Check if threshold reached → queue it
        if (op.approvals >= requiredSignatures) {
            op.status       = OpStatus.QUEUED;
            op.queuedAt     = block.timestamp;
            op.executeAfter = block.timestamp + timelockDelay;
            emit OperationQueued(opId, op.executeAfter);
        }
    }

    // ─── Execute ──────────────────────────────────────────────────

    /**
     * @notice Anyone can execute after the timelock delay has passed.
     *         This is intentional — no single party controls execution.
     */
    function execute(uint256 opId) external nonReentrant {
        Operation storage op = operations[opId];
        require(op.status == OpStatus.QUEUED, "Timelock: not queued");
        require(block.timestamp >= op.executeAfter, "Timelock: delay not passed");
        require(block.timestamp <= op.queuedAt + EXPIRY, "Timelock: execution window expired");

        op.status = OpStatus.EXECUTED;

        IStablecoinFull token = IStablecoinFull(tokenContracts[op.tokenId]);

        if (op.opType == OpType.MINT) {
            _checkAndUpdateDailyLimit(op.tokenId, op.amount);
            token.mint(op.target, op.amount, op.reason);
        } else if (op.opType == OpType.BURN) {
            token.burn(op.target, op.amount, op.reason);
        } else if (op.opType == OpType.PAUSE) {
            token.pause();
        } else if (op.opType == OpType.UNPAUSE) {
            token.unpause();
        }

        emit OperationExecuted(opId, msg.sender);
    }

    // ─── Cancel ───────────────────────────────────────────────────

    /**
     * @notice Guardian or admin can cancel at any time before execution.
     *         This is the safety net — during the 12h window, if something looks
     *         suspicious, the guardian cancels it.
     */
    function cancel(uint256 opId, string calldata reason) external {
        require(
            hasRole(GUARDIAN_ROLE, msg.sender) || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Timelock: not guardian"
        );
        Operation storage op = operations[opId];
        require(
            op.status == OpStatus.PENDING || op.status == OpStatus.QUEUED,
            "Timelock: cannot cancel"
        );
        op.status = OpStatus.CANCELLED;
        emit OperationCancelled(opId, msg.sender, reason);
    }

    // ─── Daily mint limit ─────────────────────────────────────────

    function setDailyMintLimit(bytes32 tokenId, uint256 limit)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        dailyMintLimit[tokenId] = limit;
        emit DailyLimitUpdated(tokenId, limit);
    }

    function _checkAndUpdateDailyLimit(bytes32 tokenId, uint256 amount) internal {
        uint256 limit = dailyMintLimit[tokenId];
        if (limit == 0) return; // no limit set

        uint256 today = block.timestamp / 1 days;
        if (lastMintDay[tokenId] != today) {
            dailyMintedToday[tokenId] = 0;
            lastMintDay[tokenId]      = today;
        }

        require(
            dailyMintedToday[tokenId] + amount <= limit,
            "Timelock: daily mint limit exceeded"
        );
        dailyMintedToday[tokenId] += amount;
    }

    // ─── Config updates ───────────────────────────────────────────

    function updateTimelockDelay(uint256 newDelay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newDelay >= MIN_DELAY && newDelay <= MAX_DELAY, "Timelock: invalid delay");
        emit TimelockDelayUpdated(timelockDelay, newDelay);
        timelockDelay = newDelay;
    }

    // ─── Views ────────────────────────────────────────────────────

    function getOperation(uint256 opId) external view returns (
        bytes32  tokenId,
        OpType   opType,
        address  target,
        uint256  amount,
        string memory reason,
        uint256  approvals,
        OpStatus status,
        uint256  createdAt,
        uint256  executeAfter
    ) {
        Operation storage op = operations[opId];
        return (
            op.tokenId, op.opType, op.target, op.amount,
            op.reason, op.approvals, op.status,
            op.createdAt, op.executeAfter
        );
    }

    function hasSigned(uint256 opId, address signer) external view returns (bool) {
        return operations[opId].hasSigned[signer];
    }

    function getRemainingDelay(uint256 opId) external view returns (uint256) {
        Operation storage op = operations[opId];
        if (op.status != OpStatus.QUEUED) return 0;
        if (block.timestamp >= op.executeAfter) return 0;
        return op.executeAfter - block.timestamp;
    }
}
