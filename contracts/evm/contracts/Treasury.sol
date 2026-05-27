// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IStablecoin {
    function mint(address to, uint256 amount, string calldata reason) external;
    function burn(address from, uint256 amount, string calldata reason) external;
}

/**
 * @title Treasury — Multi-sig controlled mint/burn gate
 * @notice Requires M-of-N signer approvals before any mint or burn executes.
 */
contract Treasury is AccessControl, ReentrancyGuard {
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    uint256 public requiredSignatures;
    IStablecoin public stablecoin;

    enum OpType { MINT, BURN }
    enum OpStatus { PENDING, EXECUTED, CANCELLED }

    struct Operation {
        OpType    opType;
        address   target;
        uint256   amount;
        string    reason;
        uint256   approvals;
        OpStatus  status;
        uint256   createdAt;
        mapping(address => bool) hasSigned;
    }

    uint256 public opCount;
    mapping(uint256 => Operation) public operations;

    uint256 public constant EXPIRY = 24 hours;

    event OperationCreated(uint256 indexed opId, OpType opType, address target, uint256 amount);
    event OperationSigned(uint256 indexed opId, address signer, uint256 approvals);
    event OperationExecuted(uint256 indexed opId);
    event OperationCancelled(uint256 indexed opId);

    constructor(
        address _stablecoin,
        address[] memory signers,
        uint256 _required
    ) {
        require(_required > 0 && _required <= signers.length, "Treasury: invalid threshold");
        stablecoin = IStablecoin(_stablecoin);
        requiredSignatures = _required;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        for (uint i = 0; i < signers.length; i++) {
            _grantRole(SIGNER_ROLE, signers[i]);
        }
    }

    function propose(
        OpType opType,
        address target,
        uint256 amount,
        string calldata reason
    ) external onlyRole(SIGNER_ROLE) returns (uint256 opId) {
        opId = opCount++;
        Operation storage op = operations[opId];
        op.opType    = opType;
        op.target    = target;
        op.amount    = amount;
        op.reason    = reason;
        op.status    = OpStatus.PENDING;
        op.createdAt = block.timestamp;
        emit OperationCreated(opId, opType, target, amount);
    }

    function sign(uint256 opId) external onlyRole(SIGNER_ROLE) nonReentrant {
        Operation storage op = operations[opId];
        require(op.status == OpStatus.PENDING, "Treasury: not pending");
        require(block.timestamp <= op.createdAt + EXPIRY, "Treasury: expired");
        require(!op.hasSigned[msg.sender], "Treasury: already signed");

        op.hasSigned[msg.sender] = true;
        op.approvals++;
        emit OperationSigned(opId, msg.sender, op.approvals);

        if (op.approvals >= requiredSignatures) {
            _execute(opId);
        }
    }

    function _execute(uint256 opId) internal {
        Operation storage op = operations[opId];
        op.status = OpStatus.EXECUTED;

        if (op.opType == OpType.MINT) {
            stablecoin.mint(op.target, op.amount, op.reason);
        } else {
            stablecoin.burn(op.target, op.amount, op.reason);
        }
        emit OperationExecuted(opId);
    }

    function cancel(uint256 opId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        operations[opId].status = OpStatus.CANCELLED;
        emit OperationCancelled(opId);
    }
}