// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title INRX TRC20 — for TRON Virtual Machine
 * @notice Same logic as ERC20 version but compiled for TVM
 * TronWeb uses the same Solidity syntax — just different deployment tool
 */
contract INRX_TRC20 {
    string  public name     = "e-Rupee Stablecoin";
    string  public symbol   = "INRX";
    uint8   public decimals = 6;

    uint256 public totalSupply;
    uint256 public mintCap;

    address public owner;
    address public minter;
    address public treasury;

    bool public paused;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool)                        public blacklisted;
    mapping(address => bool)                        public frozen;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);
    event Blacklisted(address indexed account, bool status);
    event Frozen(address indexed account, bool status);
    event Paused(bool status);

    modifier onlyOwner()   { require(msg.sender == owner,   "Not owner");   _; }
    modifier onlyMinter()  { require(msg.sender == minter || msg.sender == owner, "Not minter"); _; }
    modifier notPaused()   { require(!paused, "Paused"); _; }
    modifier notRestricted(address a) {
        require(!blacklisted[a] && !frozen[a], "Restricted");
        _;
    }

    constructor(uint256 _mintCap) {
        owner    = msg.sender;
        minter   = msg.sender;
        treasury = msg.sender;
        mintCap  = _mintCap;
    }

    function mint(address to, uint256 amount) external onlyMinter notPaused {
        require(!blacklisted[to] && !frozen[to], "Recipient restricted");
        require(totalSupply + amount <= mintCap, "Mint cap exceeded");
        totalSupply      += amount;
        balanceOf[to]    += amount;
        emit Mint(to, amount);
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) external notPaused {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        totalSupply           -= amount;
        emit Burn(msg.sender, amount);
        emit Transfer(msg.sender, address(0), amount);
    }

    function transfer(address to, uint256 amount)
        external notPaused
        notRestricted(msg.sender)
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
        external notPaused
        notRestricted(from)
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

    function setMinter(address _minter) external onlyOwner {
        minter = _minter;
    }

    function setMintCap(uint256 _cap) external onlyOwner {
        mintCap = _cap;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}