/** ABIs matching contracts/evm/contracts/ */

export const TOKEN_ABI = [
  // Mint / Burn
  'function mint(address to, uint256 amount, string reason) external',
  'function burn(address from, uint256 amount, string reason) external',
  'function burnFrom(uint256 amount, string reason) external',
  // Supply
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function circulatingSupply() view returns (uint256)',
  'function totalMinted() view returns (uint256)',
  'function totalBurned() view returns (uint256)',
  'function mintCap() view returns (uint256)',
  // Compliance
  'function paused() view returns (bool)',
  'function isBlacklisted(address) view returns (bool)',
  'function isFrozen(address) view returns (bool)',
  'function blacklist(address account, bool status) external',
  'function freeze(address account, bool status) external',
  'function pause() external',
  'function unpause() external',
  'function setMintCap(uint256 newCap) external',
  // Gold/Silver price (EGold/ESilver specific)
  'function goldPricePerGram() view returns (uint256)',
  'function silverPricePerGram() view returns (uint256)',
  // Events
  'event Mint(address indexed to, uint256 amount, string indexed reason)',
  'event Burn(address indexed from, uint256 amount, string indexed reason)',
  'event Blacklisted(address indexed account, bool status)',
  'event AddressFrozen(address indexed account, bool status)',
  'event MintCapUpdated(uint256 newCap)',
];

export const ORACLE_MANAGER_ABI = [
  'function getPrice(bytes32 tokenId) view returns (uint256 medianPrice, uint256 validOracleCount)',
  'function getPriceSafe(bytes32 tokenId) view returns (uint256 medianPrice, uint256 validOracleCount)',
  'function getOracles(bytes32 tokenId) view returns (address[] addresses, string[] names, uint256[] prices, uint256[] updatedAts, bool[] actives, bool[] stales)',
  'function isStale(bytes32 tokenId, address oracle) view returns (bool)',
  'function updatePrice(bytes32 tokenId, uint256 price) external',
  'function registerOracle(bytes32 tokenId, address oracle, string name) external',
  'function deactivateOracle(bytes32 tokenId, address oracle) external',
  'function reactivateOracle(bytes32 tokenId, address oracle) external',
  'function setManualPrice(bytes32 tokenId, address oracle, uint256 price) external',
  'function minOracles() view returns (uint256)',
  'function stalePriceThreshold() view returns (uint256)',
  'event PriceUpdated(bytes32 indexed tokenId, address indexed oracle, uint256 price, uint256 timestamp)',
];

export const RESERVE_VAULT_ABI = [
  'function getProofOfReserve(bytes32 tokenId) view returns (uint256 totalReserve, uint256 circulatingSupply, uint256 backingRatioBps, bool isFullyBacked, uint256 lastAuditTimestamp, string lastAuditReport)',
  'function getTotalReserve(bytes32 tokenId) view returns (uint256)',
  'function getCirculatingSupply(bytes32 tokenId) view returns (uint256)',
  'function getBackingRatio(bytes32 tokenId) view returns (uint256)',
  'function getActiveReserves(bytes32 tokenId) view returns (tuple(bytes32 tokenId, uint8 assetType, uint256 amount, string custodian, string proofHash, uint256 timestamp, address addedBy, bool active)[])',
  'function getAuditHistory(bytes32 tokenId) view returns (tuple(uint256 timestamp, address auditor, string auditorName, bytes32 tokenId, uint256 reserveAmount, uint256 circulatingSupply, string reportHash, string notes)[])',
  'function addReserve(bytes32 tokenId, uint8 assetType, uint256 amount, string custodian, string proofHash) external returns (uint256)',
  'function deactivateReserve(uint256 entryId, string reason) external',
  'function recordAudit(bytes32 tokenId, uint256 reserveAmount, uint256 circulatingSupply, string auditorName, string reportHash, string notes) external returns (uint256)',
  'function reserveCount() view returns (uint256)',
  'function auditCount() view returns (uint256)',
];

export const TREASURY_TIMELOCK_ABI = [
  'function propose(bytes32 tokenId, uint8 opType, address target, uint256 amount, string reason) external returns (uint256)',
  'function sign(uint256 opId) external',
  'function execute(uint256 opId) external',
  'function cancel(uint256 opId, string reason) external',
  'function getOperation(uint256 opId) view returns (bytes32 tokenId, uint8 opType, address target, uint256 amount, string reason, uint256 approvals, uint8 status, uint256 createdAt, uint256 executeAfter)',
  'function hasSigned(uint256 opId, address signer) view returns (bool)',
  'function getRemainingDelay(uint256 opId) view returns (uint256)',
  'function opCount() view returns (uint256)',
  'function requiredSignatures() view returns (uint256)',
  'function timelockDelay() view returns (uint256)',
  'function dailyMintLimit(bytes32 tokenId) view returns (uint256)',
  'function dailyMintedToday(bytes32 tokenId) view returns (uint256)',
  'event OperationProposed(uint256 indexed opId, bytes32 indexed tokenId, uint8 opType, address target, uint256 amount, address proposer)',
  'event OperationSigned(uint256 indexed opId, address signer, uint256 approvals)',
  'event OperationQueued(uint256 indexed opId, uint256 executeAfter)',
  'event OperationExecuted(uint256 indexed opId, address executor)',
];
