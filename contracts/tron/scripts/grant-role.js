/**
 * Tron Role Checker & Granter Script
 * 
 * Run: node scripts/check-and-grant-tron-roles.js
 * 
 * Requires:
 *   npm install tronweb dotenv
 * 
 * Put your DEPLOYER_PRIVATE_KEY in .env (the key for TR3ATTf97Kq198PV1V79oa51kAJgAsfo1f)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const { TronWeb } = require('tronweb');

// ─── Config ──────────────────────────────────────────────────────────────────

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_TRON_PRIVATE_KEY
  ?? process.env.DEPLOYER_PRIVATE_KEY
  ?? process.env.MINTER_PRIVATE_KEY;

if (!DEPLOYER_PRIVATE_KEY) {
  console.error('❌  Set DEPLOYER_TRON_PRIVATE_KEY in your .env');
  process.exit(1);
}

// THE FIX: `process.env.TRON_RPC ?? 'https://nile.trongrid.io'` only falls
// back when TRON_RPC is null/undefined — NOT when it's an empty string. If
// contracts/tron/.env has `TRON_RPC=` with nothing after the `=`, dotenv sets
// it to '' (empty string, not nullish), the `??` fallback never triggers,
// and TronWeb's HttpProvider gets an empty host — exactly the "Invalid URL
// provided to HttpProvider" crash. Using `||` (or an explicit trim+check)
// treats an empty/whitespace-only string as falsy too, so the fallback
// actually applies.
const TRON_RPC = (process.env.TRON_RPC && process.env.TRON_RPC.trim()) || 'https://nile.trongrid.io';

// Fail fast with a clear message instead of letting TronWeb's constructor
// throw a cryptic internal error if this is STILL somehow malformed.
try {
  new URL(TRON_RPC);
} catch {
  console.error(`❌  TRON_RPC is not a valid URL: "${TRON_RPC}"`);
  console.error(`    Check contracts/tron/.env — either remove the TRON_RPC line entirely`);
  console.error(`    (to use the default) or set it to a full URL, e.g.:`);
  console.error(`    TRON_RPC=https://nile.trongrid.io`);
  process.exit(1);
}
console.log(`Using TRON_RPC: ${TRON_RPC}\n`);

const tronWeb = new TronWeb({
  fullHost:   TRON_RPC,
  privateKey: DEPLOYER_PRIVATE_KEY,
  headers:    { 'TRON-PRO-API-KEY': process.env.TRON_API_KEY ?? '' },
});

// ─── Addresses ───────────────────────────────────────────────────────────────

const DEPLOYER       = 'TR3ATTf97Kq198PV1V79oa51kAJgAsfo1f';
const BLACKLISTER    = 'TXhUWeYK6GTqZedh7sAZSomacN5TEN9NAd';
const FREEZER        = 'TXhUWeYK6GTqZedh7sAZSomacN5TEN9NAd'; // same address
const RELAYER        = 'TJeCv5UTY5kGvDj39XqBXsXPQbhMh2RFcy';
const ORACLE_1       = 'THoM9QeqPUFskaZvEwf64HTX4sFGtkx9xs';
const ORACLE_2       = 'TYQFPZUnD3K3VH7W6hKgxQaGZVhphUhUqk';
const VALIDATOR_1    = 'TFKygGH1fDimkKed1NX2UhaoNMXr7VwjRb';
const VALIDATOR_2    = 'TD8LF62gum1mou9f3LR3Jpz5aT7iG22Kwq';
const VALIDATOR_3    = 'TPZfKrNsrYns9hgDFrdJqcJM5ppZdMWHRc';

// Contract addresses (41-prefix hex → convert to base58 for TronWeb)
const CONTRACTS = {
  INRX:       '41f7245fca6ef7ea21cfd494b1e351dc569e495c78',
  EGOLD:      '41c376618a143189cc795255dab8bc6c6f7e4db090',
  ESLVR:      '41d8f46578c9852cbe21939d5f0dec708f3d5f87a9',
  ORACLE_MGR: '414213fe0175cfff8e9587c76b59b90251b81ad125',
  RESERVE:    '41f89fc9a2c6f54c25b977ad8aed7066321c3b4227',
  TREASURY:   '415dbc4f25a6855e940740b133b5aaa562f6cab949',
  BRIDGE:     '41acfd9de2324f3c2c5ece509a1e0e031641c7da19',
};

// Convert 41-prefix hex to base58 address
function hexToBase58(hex) {
  return tronWeb.address.fromHex(hex);
}

const ADDR = Object.fromEntries(
  Object.entries(CONTRACTS).map(([k, v]) => [k, hexToBase58(v)])
);

// ─── Role hash helper ─────────────────────────────────────────────────────────

function roleHash(name) {
  if (name === 'DEFAULT_ADMIN_ROLE') {
    // DEFAULT_ADMIN_ROLE is always bytes32(0)
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }
  // keccak256 of the role name string
  return tronWeb.sha3(name);
}

// ─── Minimal ABI ─────────────────────────────────────────────────────────────

const ACCESS_CONTROL_ABI = [
  {
    name: 'hasRole',
    type: 'Function',
    stateMutability: 'view',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'grantRole',
    type: 'Function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'role', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [],
  },
];

// ─── Core helpers ─────────────────────────────────────────────────────────────

async function getContract(address) {
  return await tronWeb.contract(ACCESS_CONTROL_ABI, address);
}

async function hasRole(contract, roleName, address) {
  const hash = roleHash(roleName);
  try {
    const result = await contract.hasRole(hash, address).call();
    return !!result;
  } catch (err) {
    console.error(`  ⚠️  hasRole(${roleName}, ${address}) failed: ${err.message}`);
    return false;
  }
}

async function grantRole(contract, roleName, address, contractName) {
  const hash = roleHash(roleName);
  try {
    console.log(`  🔧  Granting ${roleName} to ${address} on ${contractName}…`);
    const tx = await contract.grantRole(hash, address).send({
      feeLimit: 100_000_000,
      callValue: 0,
    });
    console.log(`  ✅  Granted! TxID: ${tx}`);
    // Wait a bit between transactions to avoid nonce issues
    await sleep(3000);
  } catch (err) {
    console.error(`  ❌  grantRole(${roleName}, ${address}) failed: ${err.message}`);
  }
}

async function checkAndGrant(contractName, address, roleName, targetAddress) {
  const contract = await getContract(address);
  const already  = await hasRole(contract, roleName, targetAddress);

  if (already) {
    console.log(`  ✅  ${roleName} → ${targetAddress.slice(0, 8)}… on ${contractName} — already granted`);
  } else {
    console.log(`  ⬜  ${roleName} → ${targetAddress.slice(0, 8)}… on ${contractName} — MISSING, granting…`);
    await grantRole(contract, roleName, targetAddress, contractName);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Same fix needed in bridge-service: TronWeb's .send() only confirms a
// transaction was BROADCAST — it does not throw if the call reverts
// on-chain. Without this, a reverted grantRole (e.g. deployer genuinely
// missing DEFAULT_ADMIN_ROLE on some contract) would still print
// "✅ Granted!" here.
async function verifyTx(txId) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(2000);
    let info;
    try {
      info = await tronWeb.trx.getTransactionInfo(txId);
    } catch {
      continue;
    }
    if (!info || !info.id) continue;

    if (info.result === 'FAILED' || (info.receipt?.result && info.receipt.result !== 'SUCCESS')) {
      let reason = info.receipt?.result ?? info.result;
      if (info.resMessage) {
        try { reason = Buffer.from(info.resMessage, 'hex').toString('utf8'); } catch {}
      }
      throw new Error(`reverted on-chain: ${reason}`);
    }
    return true; // confirmed success
  }
  throw new Error('not confirmed within 20s — check it manually on Tronscan');
}

// ─── Role assignments ─────────────────────────────────────────────────────────
// Format: [contractName, contractAddress, roleName, targetAddress]

const ROLE_ASSIGNMENTS = [

  // ── DEPLOYER roles (on all token contracts + oracle + reserve + treasury + bridge) ──
  ['INRX',    ADDR.INRX,    'DEFAULT_ADMIN_ROLE', DEPLOYER],
  ['INRX',    ADDR.INRX,    'PAUSER_ROLE',        DEPLOYER],
  ['INRX',    ADDR.INRX,    'GUARDIAN_ROLE',      DEPLOYER],
  ['INRX',    ADDR.INRX,    'UPGRADER_ROLE',      DEPLOYER],
  ['INRX',    ADDR.INRX,    'MANAGER_ROLE',       DEPLOYER],
  ['INRX',    ADDR.INRX,    'CUSTODIAN_ROLE',     DEPLOYER],
  ['INRX',    ADDR.INRX,    'AUDITOR_ROLE',       DEPLOYER],
  ['INRX',    ADDR.INRX,    'MINTER_ROLE',        DEPLOYER],
  ['INRX',    ADDR.INRX,    'BURNER_ROLE',        DEPLOYER],
  ['INRX',    ADDR.INRX,    'TREASURY_ROLE',      DEPLOYER],

  ['EGOLD',   ADDR.EGOLD,   'DEFAULT_ADMIN_ROLE', DEPLOYER],
  ['EGOLD',   ADDR.EGOLD,   'PAUSER_ROLE',        DEPLOYER],
  ['EGOLD',   ADDR.EGOLD,   'GUARDIAN_ROLE',      DEPLOYER],
  ['EGOLD',   ADDR.EGOLD,   'UPGRADER_ROLE',      DEPLOYER],
  ['EGOLD',   ADDR.EGOLD,   'MANAGER_ROLE',       DEPLOYER],
  ['EGOLD',   ADDR.EGOLD,   'CUSTODIAN_ROLE',     DEPLOYER],
  ['EGOLD',   ADDR.EGOLD,   'AUDITOR_ROLE',       DEPLOYER],
  ['EGOLD',   ADDR.EGOLD,   'MINTER_ROLE',        DEPLOYER],
  ['EGOLD',   ADDR.EGOLD,   'BURNER_ROLE',        DEPLOYER],
  ['EGOLD',   ADDR.EGOLD,   'TREASURY_ROLE',      DEPLOYER],

  ['ESLVR',   ADDR.ESLVR,   'DEFAULT_ADMIN_ROLE', DEPLOYER],
  ['ESLVR',   ADDR.ESLVR,   'PAUSER_ROLE',        DEPLOYER],
  ['ESLVR',   ADDR.ESLVR,   'GUARDIAN_ROLE',      DEPLOYER],
  ['ESLVR',   ADDR.ESLVR,   'UPGRADER_ROLE',      DEPLOYER],
  ['ESLVR',   ADDR.ESLVR,   'MANAGER_ROLE',       DEPLOYER],
  ['ESLVR',   ADDR.ESLVR,   'CUSTODIAN_ROLE',     DEPLOYER],
  ['ESLVR',   ADDR.ESLVR,   'AUDITOR_ROLE',       DEPLOYER],
  ['ESLVR',   ADDR.ESLVR,   'MINTER_ROLE',        DEPLOYER],
  ['ESLVR',   ADDR.ESLVR,   'BURNER_ROLE',        DEPLOYER],
  ['ESLVR',   ADDR.ESLVR,   'TREASURY_ROLE',      DEPLOYER],

  // ── TREASURY contract — MINTER_ROLE, BURNER_ROLE, TREASURY_ROLE on tokens ──
  ['INRX',    ADDR.INRX,    'MINTER_ROLE',   ADDR.TREASURY],
  ['INRX',    ADDR.INRX,    'BURNER_ROLE',   ADDR.TREASURY],
  ['INRX',    ADDR.INRX,    'TREASURY_ROLE', ADDR.TREASURY],
  ['EGOLD',   ADDR.EGOLD,   'MINTER_ROLE',   ADDR.TREASURY],
  ['EGOLD',   ADDR.EGOLD,   'BURNER_ROLE',   ADDR.TREASURY],
  ['EGOLD',   ADDR.EGOLD,   'TREASURY_ROLE', ADDR.TREASURY],
  ['ESLVR',   ADDR.ESLVR,   'MINTER_ROLE',   ADDR.TREASURY],
  ['ESLVR',   ADDR.ESLVR,   'BURNER_ROLE',   ADDR.TREASURY],
  ['ESLVR',   ADDR.ESLVR,   'TREASURY_ROLE', ADDR.TREASURY],

  // ── BRIDGE contract — MINTER_ROLE, BURNER_ROLE on tokens ────────────────────
  ['INRX',    ADDR.INRX,    'MINTER_ROLE',   ADDR.BRIDGE],
  ['INRX',    ADDR.INRX,    'BURNER_ROLE',   ADDR.BRIDGE],
  ['EGOLD',   ADDR.EGOLD,   'MINTER_ROLE',   ADDR.BRIDGE],
  ['EGOLD',   ADDR.EGOLD,   'BURNER_ROLE',   ADDR.BRIDGE],
  ['ESLVR',   ADDR.ESLVR,   'MINTER_ROLE',   ADDR.BRIDGE],
  ['ESLVR',   ADDR.ESLVR,   'BURNER_ROLE',   ADDR.BRIDGE],

  // ── BLACKLISTER_ROLE & FREEZER_ROLE ─────────────────────────────────────────
  ['INRX',    ADDR.INRX,    'BLACKLISTER_ROLE', BLACKLISTER],
  ['INRX',    ADDR.INRX,    'FREEZER_ROLE',     FREEZER],
  ['EGOLD',   ADDR.EGOLD,   'BLACKLISTER_ROLE', BLACKLISTER],
  ['EGOLD',   ADDR.EGOLD,   'FREEZER_ROLE',     FREEZER],
  ['ESLVR',   ADDR.ESLVR,   'BLACKLISTER_ROLE', BLACKLISTER],
  ['ESLVR',   ADDR.ESLVR,   'FREEZER_ROLE',     FREEZER],

  // ── RELAYER_ROLE on bridge ───────────────────────────────────────────────────
  ['BRIDGE',  ADDR.BRIDGE,  'RELAYER_ROLE',  RELAYER],

  // ── ORACLE_ROLE on oracle manager ───────────────────────────────────────────
  ['ORACLE_MGR', ADDR.ORACLE_MGR, 'ORACLE_ROLE', ORACLE_1],
  ['ORACLE_MGR', ADDR.ORACLE_MGR, 'ORACLE_ROLE', ORACLE_2],

  // ── SIGNER_ROLE & VALIDATOR_ROLE on bridge ──────────────────────────────────
  ['BRIDGE',  ADDR.BRIDGE,  'SIGNER_ROLE',    VALIDATOR_1],
  ['BRIDGE',  ADDR.BRIDGE,  'VALIDATOR_ROLE', VALIDATOR_1],
  ['BRIDGE',  ADDR.BRIDGE,  'SIGNER_ROLE',    VALIDATOR_2],
  ['BRIDGE',  ADDR.BRIDGE,  'VALIDATOR_ROLE', VALIDATOR_2],
  ['BRIDGE',  ADDR.BRIDGE,  'SIGNER_ROLE',    VALIDATOR_3],
  ['BRIDGE',  ADDR.BRIDGE,  'VALIDATOR_ROLE', VALIDATOR_3],

  // ── DEPLOYER roles on oracle manager, reserve, treasury, bridge ─────────────
  ['ORACLE_MGR', ADDR.ORACLE_MGR, 'DEFAULT_ADMIN_ROLE', DEPLOYER],
  ['ORACLE_MGR', ADDR.ORACLE_MGR, 'MANAGER_ROLE',       DEPLOYER],
  ['RESERVE',    ADDR.RESERVE,    'DEFAULT_ADMIN_ROLE',  DEPLOYER],
  ['RESERVE',    ADDR.RESERVE,    'CUSTODIAN_ROLE',      DEPLOYER],
  ['TREASURY',   ADDR.TREASURY,   'DEFAULT_ADMIN_ROLE',  DEPLOYER],
  ['TREASURY',   ADDR.TREASURY,   'MANAGER_ROLE',        DEPLOYER],
  ['BRIDGE',     ADDR.BRIDGE,     'DEFAULT_ADMIN_ROLE',  DEPLOYER],
  ['BRIDGE',     ADDR.BRIDGE,     'MANAGER_ROLE',        DEPLOYER],
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍  Tron Role Checker & Granter');
  console.log('================================');
  console.log(`Network: ${TRON_RPC}`);
  console.log(`Deployer: ${DEPLOYER}\n`);

  // Verify deployer key matches expected address
  const deployerFromKey = tronWeb.address.fromPrivateKey(DEPLOYER_PRIVATE_KEY);
  if (deployerFromKey !== DEPLOYER) {
    console.error(`❌  Private key mismatch!`);
    console.error(`    Expected: ${DEPLOYER}`);
    console.error(`    Got:      ${deployerFromKey}`);
    console.error(`    Check DEPLOYER_TRON_PRIVATE_KEY in your .env`);
    process.exit(1);
  }
  console.log(`✅  Deployer key verified: ${DEPLOYER}\n`);

  // Group by contract for cleaner output
  const byContract = {};
  for (const [contractName] of ROLE_ASSIGNMENTS) {
    if (!byContract[contractName]) byContract[contractName] = [];
  }
  for (const assignment of ROLE_ASSIGNMENTS) {
    byContract[assignment[0]].push(assignment);
  }

  let totalChecked = 0;
  let totalGranted = 0;
  let totalAlready = 0;
  let totalFailed  = 0;

  for (const [contractName, assignments] of Object.entries(byContract)) {
    console.log(`\n📋  Contract: ${contractName} (${ADDR[contractName] ?? assignments[0][1]})`);
    console.log('─'.repeat(60));

    for (const [cName, cAddr, roleName, targetAddr] of assignments) {
      totalChecked++;
      const contract = await getContract(cAddr);
      const already  = await hasRole(contract, roleName, targetAddr);

      if (already) {
        totalAlready++;
        const shortAddr = `${targetAddr.slice(0, 10)}…${targetAddr.slice(-6)}`;
        console.log(`  ✅  ${roleName.padEnd(22)} → ${shortAddr} — already set`);
      } else {
        console.log(`  ⬜  ${roleName.padEnd(22)} → ${targetAddr.slice(0, 10)}… — granting…`);
        try {
          const hash = roleHash(roleName);
          const tx   = await contract.grantRole(hash, targetAddr).send({
            feeLimit:  100_000_000,
            callValue: 0,
          });
          await verifyTx(tx);
          console.log(`  ✅  Granted! TxID: ${tx} (confirmed on-chain)`);
          totalGranted++;
          await sleep(1000); // rate limit protection (verifyTx already waited for confirmation)
        } catch (err) {
          console.error(`  ❌  FAILED: ${err.message}`);
          totalFailed++;
        }
      }
    }
  }

  console.log('\n');
  console.log('═'.repeat(60));
  console.log('📊  Summary');
  console.log('═'.repeat(60));
  console.log(`  Total checked : ${totalChecked}`);
  console.log(`  Already set   : ${totalAlready}`);
  console.log(`  Newly granted : ${totalGranted}`);
  console.log(`  Failed        : ${totalFailed}`);
  console.log('');

  if (totalFailed > 0) {
    console.log('⚠️   Some grants failed. Common reasons:');
    console.log('    - Deployer does not have DEFAULT_ADMIN_ROLE on that contract');
    console.log('    - Contract does not have that role name (typo in ABI)');
    console.log('    - Insufficient TRX for gas (need ~10 TRX per grantRole call)');
    console.log('    - RPC rate limit — re-run the script to retry failed ones');
  } else {
    console.log('🎉  All roles are correctly assigned!');
  }
}

main().catch(err => {
  console.error('\n💥  Fatal error:', err.message);
  process.exit(1);
});