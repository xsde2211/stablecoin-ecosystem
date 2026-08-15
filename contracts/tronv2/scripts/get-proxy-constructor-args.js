const { TronWeb } = require('tronweb');
const { ethers }  = require('ethers');
const fs          = require('fs');
const path        = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const tronWeb = new TronWeb({ fullHost: process.env.TRON_RPC || 'https://nile.trongrid.io' });

function loadArtifact(name) {
  const p = path.join(__dirname, '../build/contracts', `${name}.json`);
  const a = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { abi: a.abi };
}

function toEvmAddress(addr) {
  if (typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr)) return addr;
  return '0x' + tronWeb.address.toHex(addr).slice(2);
}

function convertInitArgsForEncoding(abi, args) {
  const initFn = abi.find(f => f.type === 'function' && f.name === 'initialize');
  if (!initFn) throw new Error('No initialize() found in ABI');
  return initFn.inputs.map((input, i) => {
    const val = args[i];
    if (input.type === 'address')   return toEvmAddress(val);
    if (input.type === 'address[]') return val.map(toEvmAddress);
    return val;
  });
}

// Same env-var reads and same constants as deploy-tron.js's main() — this
// MUST stay in sync with that file, since the whole point is reconstructing
// the identical initialize() call that was actually broadcast. If any of
// these env vars changed since your real deploy, the reconstructed args
// (and therefore this proxy's expected bytecode) won't match what's
// actually on-chain, and verification will fail again.
function buildInitArgs(contractName, deployer) {
  const TRON_SIGNER_1 = process.env.TRON_SIGNER_1_ADDRESS;
  const TRON_SIGNER_2 = process.env.TRON_SIGNER_2_ADDRESS;
  const TRON_SIGNER_3 = process.env.TRON_SIGNER_3_ADDRESS;
  const TRON_GUARDIAN = process.env.TRON_GUARDIAN_ADDRESS || deployer;

  const VALIDATOR_LIST = [
    process.env.TRON_VALIDATOR_1_ADDRESS || deployer,
    process.env.TRON_VALIDATOR_2_ADDRESS || deployer,
    process.env.TRON_VALIDATOR_3_ADDRESS || deployer,
  ];
  const REQUIRED_VALIDATORS = parseInt(process.env.REQUIRED_VALIDATORS || '2');
  const REQUIRED_SIGS       = parseInt(process.env.REQUIRED_SIGS       || '2');
  const TIMELOCK_DELAY      = parseInt(process.env.TIMELOCK_DELAY_SECONDS || String(12 * 3600));

  const INRX_MINT_CAP  = '1000000000000000';
  const EGOLD_MINT_CAP = '1000000000000';
  const ESLVR_MINT_CAP = '1000000000000000';
  const GOLD_PRICE     = '5900000000';
  const SILVER_PRICE   = '75000000';

  const TABLE = {
    INRX:             [deployer, deployer, deployer, INRX_MINT_CAP],
    EGold:            [deployer, deployer, deployer, EGOLD_MINT_CAP, GOLD_PRICE],
    ESilver:          [deployer, deployer, deployer, ESLVR_MINT_CAP, SILVER_PRICE],
    OracleManager:    [deployer],
    ReserveVault:     [deployer],
    TreasuryTimelock: [[TRON_SIGNER_1, TRON_SIGNER_2, TRON_SIGNER_3], REQUIRED_SIGS, TIMELOCK_DELAY, TRON_GUARDIAN],
    TronBridge:       [REQUIRED_VALIDATORS, VALIDATOR_LIST, deployer],
  };

  if (!TABLE[contractName]) throw new Error(`Unknown contract: ${contractName}`);
  return TABLE[contractName];
}

const PROXY_ENV_VAR = {
  INRX:             'TRON_INRX_ADDRESS',
  EGold:            'TRON_EGOLD_ADDRESS',
  ESilver:          'TRON_ESLVR_ADDRESS',
  OracleManager:    'TRON_ORACLE_MANAGER_ADDRESS',
  ReserveVault:     'TRON_RESERVE_VAULT_ADDRESS',
  TreasuryTimelock: 'TRON_TREASURY_TIMELOCK_ADDRESS',
  TronBridge:       'TRON_BRIDGE_V2_ADDRESS',
};

function main() {
  const contractName = process.argv[2];
  if (!contractName || !PROXY_ENV_VAR[contractName]) {
    console.log('Usage: node scripts/get-proxy-constructor-args.js <ContractName>');
    console.log(`Valid names: ${Object.keys(PROXY_ENV_VAR).join(', ')}`);
    process.exit(1);
  }

  // Pull the implementation address from deployments/nile.json rather than
  // re-deploying anything — this is the address you already verified.
  const deploymentsPath = path.join(__dirname, '../deployments/nile.json');
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf8'));
  const implAddress = deployments.implementations?.[contractName];
  if (!implAddress) throw new Error(`No implementation address recorded for ${contractName} in deployments/nile.json`);

  const deployer = deployments.deployedBy;
  if (!deployer) throw new Error('deployedBy not found in deployments/nile.json');

  const impl = loadArtifact(contractName);
  const initArgs = buildInitArgs(contractName, deployer);
  const encodableArgs = convertInitArgsForEncoding(impl.abi, initArgs);

  const iface    = new ethers.Interface(impl.abi);
  const initData = iface.encodeFunctionData('initialize', encodableArgs);

  const implEvmAddress = toEvmAddress(implAddress);
  const constructorArgs = ethers.AbiCoder.defaultAbiCoder()
    .encode(['address', 'bytes'], [implEvmAddress, initData])
    .slice(2); // TronScan's Constructor Arguments field wants it WITHOUT the 0x prefix

  console.log(`\n${contractName} proxy: ${process.env[PROXY_ENV_VAR[contractName]] ?? '(not in .env)'}`);
  console.log(`Implementation used:  ${implAddress}  (${implEvmAddress})`);
  console.log(`\nPaste this into TronScan's "Constructor Arguments" field:\n`);
  console.log(constructorArgs);
  console.log('');
}

main();