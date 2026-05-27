// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title StablecoinBridge — Lock/Mint · Burn/Unlock cross-chain bridge
 * @dev Deployed on each EVM chain. Validators sign mint requests off-chain.
 */
contract StablecoinBridge is ReentrancyGuard, AccessControl {
    using ECDSA for bytes32;

    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant RELAYER_ROLE   = keccak256("RELAYER_ROLE");

    IERC20 public token;
    uint256 public requiredValidators;
    uint256 public chainId;

    // Replay attack protection
    mapping(bytes32 => bool) public processedNonces;

    struct BridgeRequest {
        address from;
        address to;
        uint256 amount;
        uint256 srcChainId;
        uint256 dstChainId;
        uint256 nonce;
        uint256 deadline;
    }

    event TokensLocked(address indexed from, uint256 amount, uint256 dstChainId, uint256 nonce);
    event TokensMinted(address indexed to, uint256 amount, uint256 srcChainId, bytes32 nonce);
    event TokensBurned(address indexed from, uint256 amount, uint256 dstChainId, uint256 nonce);
    event TokensUnlocked(address indexed to, uint256 amount, uint256 srcChainId, bytes32 nonce);

    constructor(
        address _token,
        address[] memory validators,
        uint256 _required,
        uint256 _chainId
    ) {
        token = IERC20(_token);
        requiredValidators = _required;
        chainId = _chainId;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        for (uint i = 0; i < validators.length; i++) {
            _grantRole(VALIDATOR_ROLE, validators[i]);
        }
    }

    /**
     * @notice Lock tokens on source chain to initiate bridge transfer
     */
    function lock(uint256 amount, uint256 dstChainId, uint256 nonce, uint256 deadline)
        external nonReentrant
    {
        require(block.timestamp <= deadline, "Bridge: deadline passed");
        require(amount > 0, "Bridge: zero amount");

        token.transferFrom(msg.sender, address(this), amount);
        emit TokensLocked(msg.sender, amount, dstChainId, nonce);
    }

    /**
     * @notice Mint tokens on destination chain after validator consensus
     */
    function mint(
        BridgeRequest calldata req,
        bytes[] calldata sigs
    ) external nonReentrant onlyRole(RELAYER_ROLE) {
        bytes32 nonceKey = keccak256(abi.encodePacked(req.srcChainId, req.nonce));
        require(!processedNonces[nonceKey], "Bridge: already processed");
        require(block.timestamp <= req.deadline, "Bridge: deadline passed");
        require(req.dstChainId == chainId, "Bridge: wrong chain");

        bytes32 msgHash = ECDSA.toEthSignedMessageHash(_hashRequest(req));
        _verifySignatures(msgHash, sigs);

        processedNonces[nonceKey] = true;

        IMintable(address(token)).mint(req.to, req.amount, "bridge_mint");
        emit TokensMinted(req.to, req.amount, req.srcChainId, nonceKey);
    }

    function _hashRequest(BridgeRequest calldata r) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            r.from, r.to, r.amount,
            r.srcChainId, r.dstChainId,
            r.nonce, r.deadline
        ));
    }

    function _verifySignatures(bytes32 hash, bytes[] calldata sigs) internal view {
        require(sigs.length >= requiredValidators, "Bridge: insufficient sigs");
        address[] memory seen = new address[](sigs.length);
        for (uint i = 0; i < sigs.length; i++) {
            address signer = hash.recover(sigs[i]);
            require(hasRole(VALIDATOR_ROLE, signer), "Bridge: invalid validator");
            for (uint j = 0; j < i; j++) {
                require(seen[j] != signer, "Bridge: duplicate signer");
            }
            seen[i] = signer;
        }
    }
}

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

interface IMintable {
    function mint(address, uint256, string calldata) external;
}