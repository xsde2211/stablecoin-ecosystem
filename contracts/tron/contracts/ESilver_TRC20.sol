// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title eSilver TRC20 — Silver-backed token for TRON
 * @notice 1 ESLVR = 1 gram of physical silver
 * @dev Compiled for TVM (TRON Virtual Machine)
 */
contract ESilver_TRC20 {
    string  public name     = "eSilver Token";
    string  public symbol   = "ESLVR";
    uint8   public decimals = 6;

    uint256 public totalSupply;
    uint256 public mintCap;

    address public owner;
    address public minter;
    address public priceOracle;

    bool public paused;

    // Silver price in INR with 6 decimal places
    // e.g. 75000000 = ₹75.00 per gram
    uint256 public silverPricePerGram;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool)                        public blacklisted;
    mapping(address => bool)                        public frozen;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Mint(address indexed to, uint256 grams, uint256 priceAtMint);
    event Burn(address indexed from, uint256 grams);
    event Blacklisted(address indexed account, bool status);
    event Frozen(address indexed account, bool status);
    event Paused(bool status);
    event SilverPriceUpdated(uint256 oldPrice, uint256 newPrice);

    modifier onlyOwner()  { require(msg.sender == owner,  "Not owner");  _; }
    modifier onlyMinter() { require(msg.sender == minter || msg.sender == owner, "Not minter"); _; }
    modifier onlyOracle() { require(msg.sender == priceOracle || msg.sender == owner, "Not oracle"); _; }
    modifier notPaused()  { require(!paused, "Contract paused"); _; }
    modifier notBlacklisted(address a) { require(!blacklisted[a], "Blacklisted"); _; }
    modifier notFrozen(address a)      { require(!frozen[a], "Frozen"); _; }

    constructor(uint256 _mintCap, uint256 _initialSilverPrice) {
        owner             = msg.sender;
        minter            = msg.sender;
        priceOracle       = msg.sender;
        mintCap           = _mintCap;
        silverPricePerGram = _initialSilverPrice;
    }

    // ─── Mint / Burn ──────────────────────────────────────────────

    function mint(address to, uint256 grams)
        external onlyMinter notPaused notBlacklisted(to) notFrozen(to)
    {
        require(totalSupply + grams <= mintCap, "Mint cap exceeded");
        totalSupply   += grams;
        balanceOf[to] += grams;
        emit Mint(to, grams, silverPricePerGram);
        emit Transfer(address(0), to, grams);
    }

    function burn(uint256 grams) external notPaused {
        require(balanceOf[msg.sender] >= grams, "Insufficient balance");
        balanceOf[msg.sender] -= grams;
        totalSupply           -= grams;
        emit Burn(msg.sender, grams);
        emit Transfer(msg.sender, address(0), grams);
    }

    // ─── Transfers ────────────────────────────────────────────────

    function transfer(address to, uint256 amount)
        external notPaused notBlacklisted(msg.sender) notFrozen(msg.sender)
        returns (bool)
    {
        require(!blacklisted[to], "Recipient blacklisted");
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external notPaused notBlacklisted(from) notFrozen(from)
        returns (bool)
    {
        require(!blacklisted[to], "Recipient blacklisted");
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Allowance exceeded");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    // ─── Oracle ───────────────────────────────────────────────────

    function updateSilverPrice(uint256 newPrice) external onlyOracle {
        require(newPrice > 0, "Price cannot be zero");
        uint256 old = silverPricePerGram;
        silverPricePerGram = newPrice;
        emit SilverPriceUpdated(old, newPrice);
    }

    // ─── Admin ────────────────────────────────────────────────────

    function setBlacklist(address account, bool status) external onlyOwner {
        blacklisted[account] = status;
        emit Blacklisted(account, status);
    }

    function setFrozen(address account, bool status) external onlyOwner {
        frozen[account] = status;
        emit Frozen(account, status);
    }

    function setPaused(bool status) external onlyOwner {
        paused = status;
        emit Paused(status);
    }

    function setMinter(address _minter)         external onlyOwner { minter = _minter; }
    function setPriceOracle(address _oracle)     external onlyOwner { priceOracle = _oracle; }
    function setMintCap(uint256 _cap)            external onlyOwner { mintCap = _cap; }
    function transferOwnership(address newOwner) external onlyOwner { owner = newOwner; }
}