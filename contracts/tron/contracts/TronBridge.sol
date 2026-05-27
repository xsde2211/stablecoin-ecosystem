// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TronBridge — Lock/Mint · Burn/Unlock for TRON
 * @notice Locks tokens on TRON, signals EVM chains to mint.
 *         Receives unlock signals from EVM chains to release locked tokens.
 * @dev Compiled for TVM. No OpenZeppelin — pure Solidity for TVM compatibility.
 */
contract TronBridge {

    address public owner;
    address public relayer;
    bool    public paused;

    uint256 public requiredValidators;
    uint256 public validatorCount;

    // nonce => processed (replay protection)
    mapping(bytes32 => bool) public processedNonces;

    // validator address => is active
    mapping(address => bool) public validators;

    // token symbol => token contract address
    mapping(string => address) public tokenContracts;

    // ─── Events ───────────────────────────────────────────────────

    event TokensLocked(
        address indexed sender,
        string  indexed token,
        uint256 amount,
        string  dstChain,
        address dstAddress,
        uint256 nonce,
        uint256 deadline
    );

    event TokensUnlocked(
        address indexed recipient,
        string  indexed token,
        uint256 amount,
        string  srcChain,
        bytes32 srcNonce
    );

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event TokenRegistered(string symbol, address contractAddr);
    event Paused(bool status);

    // ─── Modifiers ────────────────────────────────────────────────

    modifier onlyOwner()   { require(msg.sender == owner,   "Not owner");   _; }
    modifier onlyRelayer() { require(msg.sender == relayer || msg.sender == owner, "Not relayer"); _; }
    modifier notPaused()   { require(!paused, "Bridge paused"); _; }

    // ─── Constructor ──────────────────────────────────────────────

    constructor(uint256 _requiredValidators) {
        owner              = msg.sender;
        relayer            = msg.sender;
        requiredValidators = _requiredValidators;
    }

    // ─── Token Registration ───────────────────────────────────────

    function registerToken(string calldata symbol, address contractAddr)
        external onlyOwner
    {
        tokenContracts[symbol] = contractAddr;
        emit TokenRegistered(symbol, contractAddr);
    }

    // ─── Lock (TRON → other chain) ────────────────────────────────

    /**
     * @notice User calls this to start a bridge transfer FROM TRON.
     *         Tokens are locked in this contract.
     *         Backend relayer watches this event and mints on destination.
     */
    function lock(
        string  calldata token,
        uint256 amount,
        string  calldata dstChain,
        address dstAddress,
        uint256 nonce,
        uint256 deadline
    ) external notPaused {
        require(block.timestamp <= deadline,            "Bridge: deadline passed");
        require(tokenContracts[token] != address(0),   "Bridge: token not registered");
        require(amount > 0,                             "Bridge: zero amount");

        ITRC20 tokenContract = ITRC20(tokenContracts[token]);
        require(
            tokenContract.transferFrom(msg.sender, address(this), amount),
            "Bridge: transfer failed"
        );

        emit TokensLocked(
            msg.sender,
            token,
            amount,
            dstChain,
            dstAddress,
            nonce,
            deadline
        );
    }

    // ─── Unlock (other chain → TRON) ──────────────────────────────

    /**
     * @notice Relayer calls this after collecting validator signatures.
     *         Releases locked tokens to the recipient on TRON.
     */
    function unlock(
        address recipient,
        string  calldata token,
        uint256 amount,
        string  calldata srcChain,
        bytes32 srcNonce,
        bytes[] calldata signatures
    ) external onlyRelayer notPaused {
        // Replay protection
        require(!processedNonces[srcNonce], "Bridge: already processed");

        // Verify validator signatures
        bytes32 msgHash = keccak256(abi.encodePacked(
            recipient,
            token,
            amount,
            srcChain,
            srcNonce
        ));
        _verifySignatures(msgHash, signatures);

        // Mark as processed
        processedNonces[srcNonce] = true;

        // Release tokens
        ITRC20 tokenContract = ITRC20(tokenContracts[token]);
        require(
            tokenContract.transfer(recipient, amount),
            "Bridge: release failed"
        );

        emit TokensUnlocked(recipient, token, amount, srcChain, srcNonce);
    }

    // ─── Signature Verification ───────────────────────────────────

    function _verifySignatures(
        bytes32 msgHash,
        bytes[] calldata signatures
    ) internal view {
        require(
            signatures.length >= requiredValidators,
            "Bridge: insufficient signatures"
        );

        address[] memory seen = new address[](signatures.length);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = _recoverSigner(msgHash, signatures[i]);
            require(validators[signer], "Bridge: invalid validator");

            // Check no duplicate signers
            for (uint256 j = 0; j < i; j++) {
                require(seen[j] != signer, "Bridge: duplicate signer");
            }
            seen[i] = signer;
        }
    }

    function _recoverSigner(bytes32 hash, bytes memory sig)
        internal pure returns (address)
    {
        require(sig.length == 65, "Bridge: invalid sig length");

        bytes32 r;
        bytes32 s;
        uint8   v;

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }

        if (v < 27) v += 27;

        bytes32 prefixedHash = keccak256(
            abi.encodePacked("\x19TRON Signed Message:\n32", hash)
        );

        return ecrecover(prefixedHash, v, r, s);
    }

    // ─── Validator Management ─────────────────────────────────────

    function addValidator(address validator) external onlyOwner {
        require(!validators[validator], "Already a validator");
        validators[validator] = true;
        validatorCount++;
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator) external onlyOwner {
        require(validators[validator], "Not a validator");
        require(validatorCount - 1 >= requiredValidators, "Would break threshold");
        validators[validator] = false;
        validatorCount--;
        emit ValidatorRemoved(validator);
    }

    function setRequiredValidators(uint256 _required) external onlyOwner {
        require(_required > 0 && _required <= validatorCount, "Invalid threshold");
        requiredValidators = _required;
    }

    // ─── Admin ────────────────────────────────────────────────────

    function setPaused(bool status)       external onlyOwner { paused = status; emit Paused(status); }
    function setRelayer(address _relayer) external onlyOwner { relayer = _relayer; }
    function transferOwnership(address newOwner) external onlyOwner { owner = newOwner; }

    // Emergency: withdraw stuck tokens (owner only)
    function emergencyWithdraw(string calldata token, address to, uint256 amount)
        external onlyOwner
    {
        ITRC20(tokenContracts[token]).transfer(to, amount);
    }
}

// ─── Minimal TRC20 interface ──────────────────────────────────────────────────

interface ITRC20 {
    function transfer(address to, uint256 amount)     external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account)               external view returns (uint256);
}