const { TronWeb } = require('tronweb');
const fs          = require('fs');
const path        = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const tronWeb = new TronWeb({
  fullHost:   process.env.TRON_RPC || 'https://nile.trongrid.io',
  privateKey: process.env.DEPLOYER_TRON_PRIVATE_KEY,
});

function loadArtifact(name) {
  const p = path.join(__dirname, '../build/contracts', `${name}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`Build artifact not found: ${p}\nRun: pnpm --filter @ecosystem/contracts-tron compile`);
  }
  const a = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { abi: a.abi, bytecode: a.bytecode };
}

const wait = (ms = 3000) => new Promise(r => setTimeout(r, ms));

// UUPSUpgradeable's own upgradeTo(address) — identical on every upgradeable
// contract in this repo, so this one small ABI works for any of them.
// Deployer already holds UPGRADER_ROLE on every proxy (granted during
// initialize()), so it can call this directly.
const UUPS_ABI = [
  { inputs: [{ internalType: 'address', name: 'newImplementation', type: 'address' }],
    name: 'upgradeTo', outputs: [], stateMutability: 'nonpayable', type: 'function' },
];

// contractName → env var holding its PROXY address. The proxy address
// NEVER changes on an upgrade — only the implementation it points at does
// — so nothing downstream (.env, wallet-service, stablecoin-service,
// swap-service, bridge-service) needs to be touched after this runs.
const TARGETS = {
  INRX:             'TRON_INRX_ADDRESS',
  EGold:            'TRON_EGOLD_ADDRESS',
  ESilver:          'TRON_ESLVR_ADDRESS',
  OracleManager:    'TRON_ORACLE_MANAGER_ADDRESS',
  ReserveVault:     'TRON_RESERVE_VAULT_ADDRESS',
  TreasuryTimelock: 'TRON_TREASURY_TIMELOCK_ADDRESS',
  TronBridge:       'TRON_BRIDGE_V2_ADDRESS',
};

async function upgrade(contractName) {
  const proxyAddress = process.env[TARGETS[contractName]];
  if (!proxyAddress) throw new Error(`${TARGETS[contractName]} not set in .env`);

  console.log(`\n${contractName} — proxy (unchanged): ${proxyAddress}`);

  const impl = loadArtifact(contractName);
  console.log(`  Deploying new ${contractName} implementation...`);
  const implContract = await tronWeb.contract().new({
    abi: impl.abi, bytecode: impl.bytecode,
    feeLimit: 1_000_000_000, callValue: 0, parameters: [],
  });
  console.log(`  ✓ New implementation: ${implContract.address}`);
  await wait();

  console.log('  Calling upgradeTo() on the proxy...');
  const proxyAsUups = await tronWeb.contract(UUPS_ABI, proxyAddress);
  const txId = await proxyAsUups.upgradeTo(implContract.address).send({ feeLimit: 300_000_000 });
  console.log(`  ✓ Upgrade tx: ${txId}`);
  await wait();
  console.log(`  ✓ ${contractName} upgraded — proxy address is unchanged, nothing to update in .env`);
}

async function main() {
  const targets = process.argv.slice(2);
  if (!targets.length || targets.some(t => !TARGETS[t])) {
    console.log(`Usage: node scripts/upgrade-token.js <name> [more...]`);
    console.log(`Valid names: ${Object.keys(TARGETS).join(', ')}`);
    console.log(`Example: node scripts/upgrade-token.js EGold ESilver`);
    process.exit(1);
  }
  for (const t of targets) {
    await upgrade(t);
  }
  console.log('\nDone. No .env changes needed — proxy addresses stayed the same.');
}

main().catch(err => {
  console.error('\n✗ Upgrade failed:', err.message ?? err);
  process.exit(1);
});