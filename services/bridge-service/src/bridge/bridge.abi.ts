/**
 * ABIs for StablecoinBridgeV2 (EVM) and TronBridge
 * Keep in sync with contracts/evm/contracts/StablecoinBridgeV2.sol
 * and contracts/tron/contracts/TronBridge.sol
 */

export const BRIDGE_V2_ABI = [
  // Lock — user initiates
  'function lock(bytes32 tokenId, uint256 amount, uint256 dstChainId, address dstRecipient, uint256 nonce, uint256 deadline) external',
  // Mint — relayer finalizes on destination
  'function mint(tuple(bytes32 tokenId, address from, address to, uint256 amount, uint256 srcChainId, uint256 dstChainId, uint256 nonce, uint256 deadline) req, bytes[] sigs) external',
  // Burn — user initiates reverse
  'function burn(bytes32 tokenId, uint256 amount, uint256 srcChainId, address srcRecipient, uint256 nonce, uint256 deadline) external',
  // Unlock — relayer finalizes reverse on source
  'function unlock(tuple(bytes32 tokenId, address from, address to, uint256 amount, uint256 srcChainId, uint256 dstChainId, uint256 nonce, uint256 deadline) req, bytes[] sigs) external',
  // Views
  'function isNonceProcessed(bytes32 nonceKey) view returns (bool)',
  'function requiredValidators() view returns (uint256)',
  'function paused() view returns (bool)',
  'function getValidators() view returns (address[])',
  'function getSupportedTokens() view returns (bytes32[])',
  'function tokenContracts(bytes32) view returns (address)',
  // Events
  'event TokensLocked(bytes32 indexed tokenId, address indexed from, uint256 amount, uint256 dstChainId, address dstRecipient, uint256 nonce, uint256 deadline)',
  'event TokensMinted(bytes32 indexed tokenId, address indexed to, uint256 amount, uint256 srcChainId, bytes32 nonceKey)',
  'event TokensBurned(bytes32 indexed tokenId, address indexed from, uint256 amount, uint256 srcChainId, address srcRecipient, uint256 nonce, uint256 deadline)',
  'event TokensUnlocked(bytes32 indexed tokenId, address indexed to, uint256 amount, uint256 dstChainId, bytes32 nonceKey)',
];

export const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
];
