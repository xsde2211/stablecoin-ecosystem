// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title TronBridge
 * @notice TRON-specific bridge. Compiled for TVM by TronBox.
 *         Tokens (INRX, EGold, ESilver) are the same contracts as EVM —
 *         compiled from contracts/evm/contracts/ by TronBox.
 *         This contract ONLY handles TRON bridge logic.
 *
 * Flow:
 *   TRON→EVM: user calls lock()  → relayer detects → mints on EVM
 *   EVM→TRON: relayer calls mint() after EVM burn → tokens appear on TRON
 *   TRON→EVM return: user calls burn() → relayer unlocks on EVM
 *   EVM→TRON return: relayer calls unlock() after EVM lock
 *
 * @dev UUPS upgradeable, role-based access — same pattern as INRX/EGold/ESilver.
 */
contract TronBridge is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{

    // ─── Roles ────────────────────────────────────────────────────
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant RELAYER_ROLE   = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE    = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE  = keccak256("UPGRADER_ROLE");

    // ─── Config ───────────────────────────────────────────────────
    uint256 public requiredValidators;

    // token symbol → token contract address on TRON
    mapping(string  => address) public tokenContracts;
    string[] public registeredTokens;

    // replay protection: nonce key → processed
    mapping(bytes32 => bool) public processedNonces;

    // validator tracking
    address[] public validatorList;
    mapping(address => bool) public isActiveValidator;

    // daily transfer limits per token (0 = disabled)
    mapping(string => uint256) public dailyLimit;
    mapping(string => uint256) public dailyTransferred;
    mapping(string => uint256) public lastTransferDay;

    // ─── Events ───────────────────────────────────────────────────
    event TokenRegistered(string symbol, address contractAddr);

    event TokensLocked(
        string  indexed token,
        address indexed sender,
        uint256 amount,
        string  dstChain,
        address dstRecipient,
        uint256 nonce,
        uint256 deadline
    );
    event TokensMinted(
        string  indexed token,
        address indexed recipient,
        uint256 amount,
        string  srcChain,
        bytes32 nonceKey
    );
    event TokensBurned(
        string  indexed token,
        address indexed sender,
        uint256 amount,
        string  srcChain,
        address srcRecipient,
        uint256 nonce,
        uint256 deadline
    );
    event TokensUnlocked(
        string  indexed token,
        address indexed recipient,
        uint256 amount,
        string  srcChain,
        bytes32 nonceKey
    );

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event DailyLimitSet(string token, uint256 limit);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        uint256   _requiredValidators,
        address[] memory initialValidators,
        address   admin
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        require(_requiredValidators > 0, "Bridge: zero threshold");
        require(initialValidators.length >= _requiredValidators, "Bridge: not enough validators");

        requiredValidators = _requiredValidators;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);

        for (uint i = 0; i < initialValidators.length; i++) {
            _addValidator(initialValidators[i]);
        }
    }

    // ─── Token registration ───────────────────────────────────────

    function registerToken(string calldata symbol, address contractAddr)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(contractAddr != address(0), "Bridge: zero address");
        if (tokenContracts[symbol] == address(0)) {
            registeredTokens.push(symbol);
        }
        tokenContracts[symbol] = contractAddr;
        emit TokenRegistered(symbol, contractAddr);
    }

    // ─── LOCK — TRON → other chain ────────────────────────────────

    function lock(
        string  calldata token,
        uint256 amount,
        string  calldata dstChain,
        address dstRecipient,
        uint256 nonce,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        require(tokenContracts[token] != address(0), "Bridge: token not registered");
        require(block.timestamp <= deadline,          "Bridge: deadline passed");
        require(amount > 0,                           "Bridge: zero amount");
        require(dstRecipient != address(0),           "Bridge: zero recipient");

        _checkDailyLimit(token, amount);

        require(
            IERC20(tokenContracts[token]).transferFrom(msg.sender, address(this), amount),
            "Bridge: transfer failed"
        );

        emit TokensLocked(token, msg.sender, amount, dstChain, dstRecipient, nonce, deadline);
    }

    // ─── MINT — other chain → TRON (incoming tokens) ──────────────

    function mintTokens(
        string  calldata token,
        address recipient,
        uint256 amount,
        string  calldata srcChain,
        bytes32 srcNonce,
        bytes[] calldata signatures
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        require(tokenContracts[token] != address(0), "Bridge: token not registered");
        require(!processedNonces[srcNonce],           "Bridge: already processed");

        bytes32 msgHash = keccak256(abi.encodePacked(
            token, recipient, amount, srcChain, srcNonce
        ));
        _verifySignatures(msgHash, signatures);

        processedNonces[srcNonce] = true;

        IMintable(tokenContracts[token]).mint(recipient, amount, "bridge_mint");
        emit TokensMinted(token, recipient, amount, srcChain, srcNonce);
    }

    // ─── BURN — TRON → other chain (return path) ──────────────────

    function burn(
        string  calldata token,
        uint256 amount,
        string  calldata srcChain,
        address srcRecipient,
        uint256 nonce,
        uint256 deadline
    ) external nonReentrant whenNotPaused {
        require(tokenContracts[token] != address(0), "Bridge: token not registered");
        require(block.timestamp <= deadline,          "Bridge: deadline passed");
        require(amount > 0,                           "Bridge: zero amount");
        require(srcRecipient != address(0),           "Bridge: zero recipient");

        IBurnable(tokenContracts[token]).burn(msg.sender, amount, "bridge_burn");

        emit TokensBurned(token, msg.sender, amount, srcChain, srcRecipient, nonce, deadline);
    }

    // ─── UNLOCK — release locked tokens on TRON ───────────────────

    function unlock(
        string  calldata token,
        address recipient,
        uint256 amount,
        string  calldata srcChain,
        bytes32 srcNonce,
        bytes[] calldata signatures
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        require(tokenContracts[token] != address(0), "Bridge: token not registered");
        require(!processedNonces[srcNonce],           "Bridge: already processed");

        bytes32 msgHash = keccak256(abi.encodePacked(
            token, recipient, amount, srcChain, srcNonce
        ));
        _verifySignatures(msgHash, signatures);

        processedNonces[srcNonce] = true;

        require(
            IERC20(tokenContracts[token]).transfer(recipient, amount),
            "Bridge: unlock failed"
        );
        emit TokensUnlocked(token, recipient, amount, srcChain, srcNonce);
    }

    // ─── Pause ────────────────────────────────────────────────────

    function pause()   external onlyRole(PAUSER_ROLE) { _pause();   }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function emergencyWithdraw(string calldata token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) whenPaused
    {
        require(to != address(0), "Bridge: zero address");
        IERC20(tokenContracts[token]).transfer(to, amount);
    }

    // ─── Validator management ─────────────────────────────────────

    function addValidator(address validator)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _addValidator(validator);
    }

    function _addValidator(address validator) internal {
        require(validator != address(0),       "Bridge: zero address");
        require(!isActiveValidator[validator], "Bridge: already validator");
        isActiveValidator[validator] = true;
        validatorList.push(validator);
        _grantRole(VALIDATOR_ROLE, validator);
        emit ValidatorAdded(validator);
    }

    function removeValidator(address validator)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
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
        require(newRequired <= _activeValidatorCount(), "Bridge: exceeds count");
        requiredValidators = newRequired;
    }

    function addRelayer(address relayer)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _grantRole(RELAYER_ROLE, relayer);
    }

    // ─── Daily limit ──────────────────────────────────────────────

    function setDailyLimit(string calldata token, uint256 limit)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        dailyLimit[token] = limit;
        emit DailyLimitSet(token, limit);
    }

    function _checkDailyLimit(string memory token, uint256 amount) internal {
        uint256 limit = dailyLimit[token];
        if (limit == 0) return;
        uint256 today = block.timestamp / 1 days;
        if (lastTransferDay[token] != today) {
            dailyTransferred[token] = 0;
            lastTransferDay[token]  = today;
        }
        require(
            dailyTransferred[token] + amount <= limit,
            "Bridge: daily limit exceeded"
        );
        dailyTransferred[token] += amount;
    }

    // ─── Signature verification ───────────────────────────────────

    function _verifySignatures(bytes32 msgHash, bytes[] calldata sigs) internal view {
        require(sigs.length >= requiredValidators, "Bridge: insufficient sigs");
        address[] memory seen = new address[](sigs.length);
        for (uint i = 0; i < sigs.length; i++) {
            address signer = _recover(msgHash, sigs[i]);
            require(isActiveValidator[signer], "Bridge: invalid validator");
            for (uint j = 0; j < i; j++) {
                require(seen[j] != signer, "Bridge: duplicate signer");
            }
            seen[i] = signer;
        }
    }

    function _recover(bytes32 hash, bytes memory sig)
        internal pure returns (address)
    {
        require(sig.length == 65, "Bridge: invalid sig length");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        // TRON uses same prefix as Ethereum
        bytes32 prefixed = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
        );
        return ecrecover(prefixed, v, r, s);
    }

    // ─── Views ────────────────────────────────────────────────────

    function _activeValidatorCount() internal view returns (uint256 n) {
        for (uint i = 0; i < validatorList.length; i++) {
            if (isActiveValidator[validatorList[i]]) n++;
        }
    }

    function getActiveValidators() external view returns (address[] memory out) {
        uint256 n = _activeValidatorCount();
        out = new address[](n);
        uint256 idx = 0;
        for (uint i = 0; i < validatorList.length; i++) {
            if (isActiveValidator[validatorList[i]]) out[idx++] = validatorList[i];
        }
    }

    function getRegisteredTokens() external view returns (string[] memory) {
        return registeredTokens;
    }

    // ─── Upgrade authorization ──────────────────────────────────────

    function _authorizeUpgrade(address newImplementation)
        internal override onlyRole(UPGRADER_ROLE) {}

    uint256[50] private __gap;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IMintable {
    function mint(address to, uint256 amount, string calldata reason) external;
}

interface IBurnable {
    function burn(address from, uint256 amount, string calldata reason) external;
}
