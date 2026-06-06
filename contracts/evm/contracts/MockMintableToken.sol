// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockMintableToken — Used only in tests
 * @dev Simulates INRX/EGold/ESilver for unit testing Treasury, Bridge, etc.
 */
contract MockMintableToken {

    string  public name     = "Mock Token";
    string  public symbol   = "MOCK";
    uint8   public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool)                        public minters;
    mapping(address => bool)                        public burners;

    address public owner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() { owner = msg.sender; minters[owner] = true; burners[owner] = true; }

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }

    function grantMinter(address m) external onlyOwner { minters[m] = true; }
    function grantBurner(address b) external onlyOwner { burners[b] = true; }

    function mint(address to, uint256 amount) external {
        require(minters[msg.sender], "Not minter");
        totalSupply  += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    // Called by bridge: mint(address, uint256, string)
    function mint(address to, uint256 amount, string calldata) external {
        require(minters[msg.sender], "Not minter");
        totalSupply   += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(burners[msg.sender], "Not burner");
        require(balanceOf[from] >= amount, "Insufficient balance");
        totalSupply    -= amount;
        balanceOf[from] -= amount;
        emit Transfer(from, address(0), amount);
    }

    // Called by bridge: burn(address, uint256, string)
    function burn(address from, uint256 amount, string calldata) external {
        require(burners[msg.sender], "Not burner");
        require(balanceOf[from] >= amount, "Insufficient balance");
        totalSupply     -= amount;
        balanceOf[from]  -= amount;
        emit Transfer(from, address(0), amount);
    }

    // Self-burn for TronBridgeV2 pattern
    function burn(uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        totalSupply          -= amount;
        balanceOf[msg.sender] -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    // TreasuryTimelock pause/unpause interface
    function pause()   external {}
    function unpause() external {}

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient");
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

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Allowance exceeded");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
