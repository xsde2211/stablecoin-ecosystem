const { TronWeb } = require('tronweb');
const path        = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// ─── Why this exists ────────────────────────────────────────────────────────
//
// deploy-tron.js grants roles using *_ADDRESS env vars (e.g.
// TRON_RELAYER_ADDRESS, TRON_VALIDATOR_1_ADDRESS), while bridge-service
// actually SIGNS transactions using the corresponding *_PRIVATE_KEY vars
// (RELAYER_TRON_PRIVATE_KEY, TRON_VALIDATOR_1_PRIVATE_KEY, ...). If those
// two ever drift apart — exactly what seems to have happened with
// DEPLOYER_TRON_PRIVATE_KEY vs whatever address actually holds admin —
// a fresh deploy would silently grant roles to the WRONG address again,
// and you'd be right back here with a new "AccessControl: missing role"
// error after redeploying.
//
// Run this BEFORE deploy-tron.js and fix any ✗ MISMATCH before proceeding.

const tronWeb = new TronWeb({ fullHost: process.env.TRON_RPC || 'https://nile.trongrid.io' });

function deriveAddress(privateKey) {
  if (!privateKey) return null;
  try {
    return tronWeb.address.fromPrivateKey(privateKey.replace(/^0x/, ''));
  } catch {
    return null;
  }
}

// Pairs of [privateKeyEnvVar, addressEnvVar] that deploy-tron.js relies on
// being consistent with each other.
const PAIRS = [
  ['DEPLOYER_TRON_PRIVATE_KEY',    null], // deployer's address IS whatever this key derives to — nothing to compare, just shown for reference
  ['RELAYER_TRON_PRIVATE_KEY',     'RELAYER_TRON_ADDRESS'],
  ['TRON_VALIDATOR_1_PRIVATE_KEY', 'TRON_VALIDATOR_1_ADDRESS'],
  ['TRON_VALIDATOR_2_PRIVATE_KEY', 'TRON_VALIDATOR_2_ADDRESS'],
  ['TRON_VALIDATOR_3_PRIVATE_KEY', 'TRON_VALIDATOR_3_ADDRESS'],
  ['TRON_ORACLE_1_PRIVATE_KEY',    'TRON_ORACLE_1_ADDRESS'],
  ['TRON_ORACLE_2_PRIVATE_KEY',    'TRON_ORACLE_2_ADDRESS'],
];

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║   TRON env key/address consistency check                    ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

let anyMismatch = false;

for (const [pkVar, addrVar] of PAIRS) {
  const pk = process.env[pkVar];
  if (!pk) {
    console.log(`⚠ ${pkVar} not set — skipping`);
    continue;
  }
  const derived = deriveAddress(pk);

  if (!addrVar) {
    console.log(`${pkVar} → ${derived}  (this IS the effective address — deploy-tron.js uses it directly as "deployer")`);
    continue;
  }

  const configured = process.env[addrVar];
  const match = configured === derived;
  if (!match) anyMismatch = true;

  console.log(`${match ? '✓' : '✗ MISMATCH'}  ${pkVar} → ${derived}`);
  console.log(`         ${addrVar} = ${configured || '(not set)'}`);
  console.log('');
}

console.log(anyMismatch
  ? '⚠ Fix every MISMATCH above (set the *_ADDRESS var to the derived address shown) before running deploy-tron.js again.'
  : '✓ Everything lines up — safe to run deploy-tron.js.'
);