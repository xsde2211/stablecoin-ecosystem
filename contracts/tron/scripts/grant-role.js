const { TronWeb } = require('tronweb');
require("dotenv").config({
  path: "../../../.env",
});

console.log("SCRIPT STARTED");

const TRON_RPC           = process.env.TRON_RPC || 'https://nile.trongrid.io';
const BRIDGE_ADDRESS     = process.env.TRON_BRIDGE_V2_ADDRESS;
const ADMIN_PRIVATE_KEY  = process.env.DEPLOYER_TRON_PRIVATE_KEY;
const SHOULD_FIX         = process.argv.includes('--fix');

const VALIDATOR_KEYS = [
  process.env.TRON_VALIDATOR_1_PRIVATE_KEY,
  process.env.TRON_VALIDATOR_2_PRIVATE_KEY,
  process.env.TRON_VALIDATOR_3_PRIVATE_KEY, 
].filter(Boolean);

async function main() {
  if (!BRIDGE_ADDRESS) {
    console.error('Set TRON_BRIDGE_V2_ADDRESS.');
    process.exit(1);
  }
  if (VALIDATOR_KEYS.length === 0) {
    console.error('Set at least TRON_VALIDATOR_1_PRIVATE_KEY and TRON_VALIDATOR_2_PRIVATE_KEY — the same ones bridge.service.ts signs with.');
    process.exit(1);
  }

  console.log("TRON_RPC:", TRON_RPC);
console.log("BRIDGE_ADDRESS:", BRIDGE_ADDRESS);

const readOnly = new TronWeb({ fullHost: TRON_RPC });

// Use any valid address as the caller
const caller = TronWeb.address.fromPrivateKey(
  VALIDATOR_KEYS[0].replace(/^0x/, "")
);

readOnly.setAddress(caller);

const bridgeRO = await readOnly.contract().at(BRIDGE_ADDRESS);

const required = await bridgeRO.requiredValidators().call();
console.log("Required:", required);

  // Derive each configured validator's TRON (base58) address from its
  // private key — same derivation bridge.service.ts implicitly relies on
  // when it does `new ethers.Wallet(key)`, just expressed as a TRON address
  // instead of an EVM one (same secp256k1 key, same underlying address).
  const candidates = VALIDATOR_KEYS.map((key, i) => {
    const hex = key.replace(/^0x/, '');
    const tronAddress = TronWeb.address.fromPrivateKey(hex);
    return { label: `VALIDATOR_${i + 1}_PRIVATE_KEY`, tronAddress };
  });

  console.log('Configured validator keys → TRON addresses:');
  let activeCount = 0;
  const missing = [];
  for (const c of candidates) {
    const isActive = await bridgeRO.isActiveValidator(c.tronAddress).call();
    console.log(`  ${c.label.padEnd(24)} ${c.tronAddress}  ${isActive ? '✓ active on this contract' : '✗ NOT registered here'}`);
    if (isActive) activeCount++;
    else missing.push(c.tronAddress);
  }

  console.log(`\n${activeCount}/${candidates.length} configured validators are active on this TronBridge.`);
  if (activeCount < required) {
    console.log(`⚠ That's below the required threshold of ${required} — mint/unlock WILL keep failing with "Bridge: invalid validator" until this is fixed.`);
  } else {
    console.log('✓ Enough active validators to reach quorum — if mints are still failing, look elsewhere (msgHash mismatch, wrong nonce, etc.).');
  }

  if (missing.length === 0) {
    console.log('\nNothing to register — all configured validators are already active.');
    return;
  }

  if (!SHOULD_FIX) {
    console.log(`\nRe-run with --fix (and TRON_ADMIN_PRIVATE_KEY set) to register the ${missing.length} missing address(es) above.`);
    return;
  }

  if (!ADMIN_PRIVATE_KEY) {
    console.error('\n--fix requires TRON_ADMIN_PRIVATE_KEY (the contract admin/deployer key — addValidator() is onlyRole(DEFAULT_ADMIN_ROLE)).');
    process.exit(1);
  }

  console.log("Admin PK loaded:", !!ADMIN_PRIVATE_KEY);
console.log("Admin PK length:", ADMIN_PRIVATE_KEY?.length);

  const admin       = new TronWeb({ fullHost: TRON_RPC, privateKey: ADMIN_PRIVATE_KEY });
  const bridgeAdmin = await admin.contract().at(BRIDGE_ADDRESS);

  console.log(`\nRegistering ${missing.length} validator(s)...`);
  for (const address of missing) {
    const txId = await bridgeAdmin.addValidator(address).send({ feeLimit: 100_000_000 });
    console.log(`  addValidator(${address}) sent: ${txId}`);
    console.log(`    https://nile.tronscan.org/#/transaction/${txId}`);
  }
  console.log('\nDone. Re-run without --fix to confirm they show as active.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});