// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title StablecoinBridgeV2 — Complete Lock/Mint + Burn/Unlock bridge
 * @notice Replaces StablecoinBridge.sol with:
 *   1. pause() / unpause()           — emergency stop
 *   2. burn() + unlock() flow        — return tokens from dest → source
 *   3. Dynamic validator management  — add/remove validators without redeploy
 *   4. Support for all 3 tokens      — INRX, EGOLD, ESLVR
 *   5. Relayer role separate         — relayer != validator
 *
 * @dev Deployed on each EVM chain (Sepolia, Polygon Amoy, BSC Testnet).
 */
contract StablecoinBridgeV2 is ReentrancyGuard, Pausable, AccessControl {
    using ECDSA for bytes32;

    // ─── Roles ────────────────────────────────────────────────────
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant RELAYER_ROLE   = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE    = keccak256("PAUSER_ROLE");

    // ─── Config ───────────────────────────────────────────────────
    uint256 public requiredValidators;
    uint256 public chainId;

    // ─── Token registry ───────────────────────────────────────────
    // tokenId (bytes32) → token contract address
    mapping(bytes32 => address) public tokenContracts;
    bytes32[] public supportedTokens;

    // ─── Replay protection ────────────────────────────────────────
    mapping(bytes32 => bool) public processedNonces;

    // ─── Validator tracking ───────────────────────────────────────
    address[] public validatorList;
    mapping(address => bool) public isActiveValidator;

    // ─── Bridge Request ───────────────────────────────────────────
    struct BridgeRequest {
        bytes32 tokenId;
        address from;
        address to;
        uint256 amount;
        uint256 srcChainId;
        uint256 dstChainId;
        uint256 nonce;
        uint256 deadline;
    }

    // ─── Events ───────────────────────────────────────────────────
    event TokenRegistered(bytes32 indexed tokenId, address contractAddress);

    // Lock → user sends tokens to bridge on source chain
    event TokensLocked(
        bytes32 indexed tokenId,
        address indexed from,
        uint256 amount,
        uint256 dstChainId,
        address dstRecipient,
        uint256 nonce,
        uint256 deadline
    );
    // Mint → bridge mints tokens on destination chain
    event TokensMinted(
        bytes32 indexed tokenId,
        address indexed to,
        uint256 amount,
        uint256 srcChainId,
        bytes32 nonceKey
    );
    // Burn → user burns tokens on destination chain to go back
    event TokensBurned(
        bytes32 indexed tokenId,
        address indexed from,
        uint256 amount,
        uint256 srcChainId,
        address srcRecipient,
        uint256 nonce,
        uint256 deadline
    );
    // Unlock → bridge releases locked tokens on source chain
    event TokensUnlocked(
        bytes32 indexed tokenId,
        address indexed to,
        uint256 amount,
        uint256 dstChainId,
        bytes32 nonceKey
    );

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event RequiredValidatorsUpdated(uint256 oldVal, uint256 newVal);

    // ─── Constructor ──────────────────────────────────────────────
    constructor(
        address[] memory validators,
        uint256   _required,
        uint256   _chainId,
        address   admin
    ) {
        require(_required > 0 && _required <= validators.length, "Bridge: invalid threshold");
        requiredValidators = _required;
        chainId = _chainId;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE,        admin);

        for (uint i = 0; i < validators.length; i++) {
            _addValidator(validators[i]);
        }
    }

    // ─── Token registration ───────────────────────────────────────

    function registerToken(bytes32 tokenId, address contractAddress)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(contractAddress != address(0), "Bridge: zero address");
        if (tokenContracts[tokenId] == address(0)) {
            supportedTokens.push(tokenId);
        }
        tokenContracts[tokenId] = contractAddress;
        emit TokenRegistered(tokenId, contractAddress);
    }

    // ─── LOCK — Source chain (tokens go INTO bridge) ──────────────

    /**
     * @notice User locks tokens here to bridge them to another chain.
     *         Relayer watches TokensLocked events and triggers mint on destination.
     *
     * @param tokenId      keccak256("INRX") / keccak256("EGOLD") / keccak256("ESLVR")
     * @param amount       Amount to bridge (6 decimals)
     * @param dstChainId   Destination chain ID
     * @param dstRecipient Recipient address on destination chain
     * @param nonce        Unique nonce (use Date.now() from backend)
     * @param deadline     Unix timestamp — transaction invalid after this
     */
    function lock(
        bytes32 tokenId,
        uint256 amount,
        uint256 dstChainId,
        address dstRecipient,
        uint256 nonce,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        require(block.timestamp <= deadline,                  "Bridge: deadline passed");
        require(amount > 0,                                    "Bridge: zero amount");
        require(tokenContracts[tokenId] != address(0),        "Bridge: token not registered");
        require(dstChainId != chainId,                         "Bridge: same chain");
        require(dstRecipient != address(0),                    "Bridge: zero recipient");

        IERC20Like(tokenContracts[tokenId]).transferFrom(msg.sender, address(this), amount);

        emit TokensLocked(tokenId, msg.sender, amount, dstChainId, dstRecipient, nonce, deadline);
    }

    // ─── MINT — Destination chain (tokens come OUT of bridge) ─────

    /**
     * @notice Relayer calls this after collecting enough validator signatures.
     *         Mints new tokens on destination chain.
     */
    function mint(
        BridgeRequest calldata req,
        bytes[]       calldata sigs
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        bytes32 nonceKey = keccak256(abi.encodePacked(req.srcChainId, req.nonce));
        require(!processedNonces[nonceKey],     "Bridge: already processed");
        require(block.timestamp <= req.deadline, "Bridge: deadline passed");
        require(req.dstChainId == chainId,       "Bridge: wrong chain");
        require(tokenContracts[req.tokenId] != address(0), "Bridge: token not registered");

        bytes32 msgHash = ECDSA.toEthSignedMessageHash(_hashRequest(req));
        _verifySignatures(msgHash, sigs);

        processedNonces[nonceKey] = true;

        IMintable(tokenContracts[req.tokenId]).mint(req.to, req.amount, "bridge_mint");
        emit TokensMinted(req.tokenId, req.to, req.amount, req.srcChainId, nonceKey);
    }

    // ─── BURN — Destination chain (user wants to go back) ─────────

    /**
     * @notice User burns bridged tokens on destination chain to return to source.
     *         This is the reverse of lock. Tokens are burned here.
     *         Relayer watches TokensBurned and calls unlock() on source chain.
     *
     * @param tokenId      Token to burn
     * @param amount       Amount to burn
     * @param srcChainId   Source chain ID (where tokens will be unlocked)
     * @param srcRecipient Recipient address on source chain
     * @param nonce        Unique nonce
     * @param deadline     Expiry timestamp
     */
    function burn(
        bytes32 tokenId,
        uint256 amount,
        uint256 srcChainId,
        address srcRecipient,
        uint256 nonce,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        require(block.timestamp <= deadline,           "Bridge: deadline passed");
        require(amount > 0,                             "Bridge: zero amount");
        require(tokenContracts[tokenId] != address(0), "Bridge: token not registered");
        require(srcChainId != chainId,                  "Bridge: same chain");
        require(srcRecipient != address(0),             "Bridge: zero recipient");

        // Burn tokens from user — user must have approved bridge first
        IBurnable(tokenContracts[tokenId]).burn(msg.sender, amount, "bridge_burn");

        emit TokensBurned(tokenId, msg.sender, amount, srcChainId, srcRecipient, nonce, deadline);
    }

    // ─── UNLOCK — Source chain (releases locked tokens) ───────────

    /**
     * @notice Relayer calls this on the SOURCE chain after burn event on destination.
     *         Releases previously locked tokens to the original sender.
     */
    function unlock(
        BridgeRequest calldata req,
        bytes[]       calldata sigs
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        bytes32 nonceKey = keccak256(abi.encodePacked(req.srcChainId, req.nonce));
        require(!processedNonces[nonceKey],     "Bridge: already processed");
        require(block.timestamp <= req.deadline, "Bridge: deadline passed");
        require(req.srcChainId == chainId,       "Bridge: wrong chain");
        require(tokenContracts[req.tokenId] != address(0), "Bridge: token not registered");

        bytes32 msgHash = ECDSA.toEthSignedMessageHash(_hashRequest(req));
        _verifySignatures(msgHash, sigs);

        processedNonces[nonceKey] = true;

        // Transfer locked tokens to recipient
        require(
            IERC20Like(tokenContracts[req.tokenId]).transfer(req.to, req.amount),
            "Bridge: unlock transfer failed"
        );
        emit TokensUnlocked(req.tokenId, req.to, req.amount, req.dstChainId, nonceKey);
    }

    // ─── Emergency pause ──────────────────────────────────────────

    function pause()   external onlyRole(PAUSER_ROLE) { _pause();   }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    /**
     * @notice Emergency token recovery — withdraw any stuck tokens to admin.
     *         Only callable when paused.
     */
    function emergencyWithdraw(bytes32 tokenId, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) whenPaused
    {
        require(to != address(0), "Bridge: zero address");
        IERC20Like(tokenContracts[tokenId]).transfer(to, amount);
    }

    // ─── Validator management ─────────────────────────────────────

    function addValidator(address validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _addValidator(validator);
    }

    function _addValidator(address validator) internal {
        require(validator != address(0),           "Bridge: zero address");
        require(!isActiveValidator[validator],     "Bridge: already validator");
        isActiveValidator[validator] = true;
        validatorList.push(validator);
        _grantRole(VALIDATOR_ROLE, validator);
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(isActiveValidator[validator], "Bridge: not a validator");
        require(
            _activeValidatorCount() - 1 >= requiredValidators,
            "Bridge: would break threshold"
        );
        isActiveValidator[validator] = false;
        _revokeRole(VALIDATOR_ROLE, validator);
        emit ValidatorRemoved(validator);
    }

    function updateRequiredValidators(uint256 newRequired)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(newRequired > 0, "Bridge: zero required");
        require(newRequired <= _activeValidatorCount(), "Bridge: exceeds validator count");
        emit RequiredValidatorsUpdated(requiredValidators, newRequired);
        requiredValidators = newRequired;
    }

    function addRelayer(address relayer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(RELAYER_ROLE, relayer);
    }

    // ─── Internal helpers ─────────────────────────────────────────

    function _hashRequest(BridgeRequest calldata r) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            r.tokenId, r.from, r.to, r.amount,
            r.srcChainId, r.dstChainId, r.nonce, r.deadline
        ));
    }

    function _verifySignatures(bytes32 hash, bytes[] calldata sigs) internal view {
        require(sigs.length >= requiredValidators, "Bridge: insufficient sigs");
        address[] memory seen = new address[](sigs.length);
        for (uint i = 0; i < sigs.length; i++) {
            address signer = hash.recover(sigs[i]);
            require(isActiveValidator[signer], "Bridge: invalid validator");
            for (uint j = 0; j < i; j++) {
                require(seen[j] != signer, "Bridge: duplicate signer");
            }
            seen[i] = signer;
        }
    }

    function _activeValidatorCount() internal view returns (uint256 count) {
        for (uint i = 0; i < validatorList.length; i++) {
            if (isActiveValidator[validatorList[i]]) count++;
        }
    }

    // ─── Views ────────────────────────────────────────────────────

    function getValidators() external view returns (address[] memory active) {
        uint256 count = _activeValidatorCount();
        active = new address[](count);
        uint256 idx = 0;
        for (uint i = 0; i < validatorList.length; i++) {
            if (isActiveValidator[validatorList[i]]) {
                active[idx++] = validatorList[i];
            }
        }
    }

    function getSupportedTokens() external view returns (bytes32[] memory) {
        return supportedTokens;
    }

    function isNonceProcessed(bytes32 nonceKey) external view returns (bool) {
        return processedNonces[nonceKey];
    }
}

interface IERC20Like {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IMintable {
    function mint(address to, uint256 amount, string calldata reason) external;
}

interface IBurnable {
    function burn(address from, uint256 amount, string calldata reason) external;
}
