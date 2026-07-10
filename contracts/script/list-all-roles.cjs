// list-all-roles.js
//
// Audits every AccessControl role, on every contract, across every chain in
// the ecosystem (Ethereum, BSC, Polygon, TRON) — answers "who has what role
// where" in one run.
//
// SCOPE (per your note): EGold, ESilver, INRx/INRX, OracleManager,
// TreasuryTimelock, and ReserveVault are byte-for-byte identical between
// evm/ and tron/ (confirmed via diff), so one role registry covers both.
// Only the bridge differs by name — StablecoinBridgeV2 on EVM vs TronBridge
// on TRON — but both define the exact same three role names, so they share
// one entry below too. The old evm/StablecoinBridge.sol and evm/Treasury.sol
// are the previous version and are intentionally NOT included.
//
// HOW IT WORKS (same approach as list-tron-roles.js, extended to EVM too):
// Plain OpenZeppelin AccessControl has no "list all role holders" function —
// only hasRole(role, address) for one address at a time. So this script:
//   1. Computes each role's bytes32 hash itself: keccak256(utf8("ROLE_NAME"))
//      is identical on every chain (it's just hashing a string), so the
//      hashes never need to be fetched on-chain — ethers.id() does this.
//   2. Replays every RoleGranted/RoleRevoked event each contract has ever
//      emitted (via eth_getLogs on EVM, TronGrid's event API on TRON) to
//      reconstruct who currently holds what.
//   3. Double-checks every candidate live via hasRole() — event history can
//      lag or (on some public nodes) be capped by a block-range limit, so
//      this is the actual source of truth; the events just tell us which
//      addresses are worth checking.
//
// SETUP — environment variables (only set what you've actually deployed;
// anything missing is just skipped with a note):
//
//   RPC per chain:
//     ETH_RPC, BSC_RPC, POLYGON_RPC, TRON_RPC
//
//   Contract addresses, per chain, using the same {CHAIN}_{KEY}_ADDRESS
//   convention already used elsewhere in this project
//   (e.g. bridge.processor.ts's getTokenAddress, TRON_BRIDGE_V2_ADDRESS):
//     {CHAIN}_EGOLD_ADDRESS
//     {CHAIN}_ESLVR_ADDRESS
//     {CHAIN}_INRX_ADDRESS
//     {CHAIN}_ORACLE_MANAGER_ADDRESS
//     {CHAIN}_TREASURY_TIMELOCK_ADDRESS
//     {CHAIN}_RESERVE_VAULT_ADDRESS
//     {CHAIN}_BRIDGE_V2_ADDRESS
//   where {CHAIN} is one of ETH, BSC, POLYGON, TRON.
//
//   Optional, strongly recommended for EVM chains — without it, event
//   scanning starts from block 0, which is slow and will likely hit
//   provider block-range limits on a live/testnet chain with real history:
//     {CHAIN}_DEPLOY_BLOCK   (e.g. ETH_DEPLOY_BLOCK=8123456)
//
// USAGE:
//   npm i ethers tronweb   (if not already available)
//   node list-all-roles.js
//
// Needs no private keys — this only reads.

const { ethers } = require('ethers');
const { TronWeb } = require('tronweb');
require("dotenv").config();

// ── Role registry ────────────────────────────────────────────────────────────
// One entry per contract *type*. `key` builds the env var name
// ({CHAIN}_{key}_ADDRESS); `roles` are that contract's role names verbatim
// from source. DEFAULT_ADMIN_ROLE (0x00...00) is checked for every contract
// automatically, no need to list it here.
const CONTRACT_TYPES = [
  { key: 'EGOLD',              label: 'EGold',             roles: ['MINTER_ROLE', 'BURNER_ROLE', 'FREEZER_ROLE', 'UPGRADER_ROLE', 'BLACKLISTER_ROLE', 'TREASURY_ROLE'] },
  { key: 'ESLVR',               label: 'ESilver',           roles: ['MINTER_ROLE', 'BURNER_ROLE', 'FREEZER_ROLE', 'UPGRADER_ROLE', 'BLACKLISTER_ROLE', 'TREASURY_ROLE'] },
  { key: 'INRX',                 label: 'INRx',              roles: ['MINTER_ROLE', 'BURNER_ROLE', 'FREEZER_ROLE', 'UPGRADER_ROLE', 'BLACKLISTER_ROLE', 'TREASURY_ROLE'] },
  { key: 'ORACLE_MANAGER',       label: 'OracleManager',     roles: ['ORACLE_ROLE', 'MANAGER_ROLE'] },
  { key: 'TREASURY_TIMELOCK',    label: 'TreasuryTimelock',  roles: ['SIGNER_ROLE', 'GUARDIAN_ROLE'] },
  { key: 'RESERVE_VAULT',        label: 'ReserveVault',      roles: ['CUSTODIAN_ROLE', 'AUDITOR_ROLE'] },
  // StablecoinBridgeV2 (EVM) / TronBridge (TRON) — same role names, one entry.
  { key: 'BRIDGE_V2',            label: 'Bridge (StablecoinBridgeV2 / TronBridge)', roles: ['VALIDATOR_ROLE', 'RELAYER_ROLE', 'PAUSER_ROLE'] },
];

const DEFAULT_ADMIN_ROLE = '0x' + '0'.repeat(64);

const EVM_CHAINS = ['ETH', 'BSC', 'POLYGON'];
const ALL_CHAINS = [...EVM_CHAINS, 'TRON'];

const HAS_ROLE_ABI_HUMAN = ['function hasRole(bytes32,address) view returns (bool)'];
const HAS_ROLE_ABI_JSON  = [{
  constant: true,
  inputs: [{ name: 'role', type: 'bytes32' }, { name: 'account', type: 'address' }],
  name: 'hasRole',
  outputs: [{ name: '', type: 'bool' }],
  stateMutability: 'view',
  type: 'function',
}];

const ROLE_EVENTS_IFACE = new ethers.Interface([
  'event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)',
  'event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)',
]);
const ROLE_GRANTED_TOPIC = ROLE_EVENTS_IFACE.getEvent('RoleGranted').topicHash;
const ROLE_REVOKED_TOPIC = ROLE_EVENTS_IFACE.getEvent('RoleRevoked').topicHash;

function roleHashesFor(contractType) {
  const map = { [DEFAULT_ADMIN_ROLE]: 'DEFAULT_ADMIN_ROLE' };
  for (const name of contractType.roles) {
    map[ethers.id(name)] = name; // keccak256(utf8(name)) — identical on every chain
  }
  return map;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── EVM: scan RoleGranted/RoleRevoked logs, chunked to dodge provider
// block-range limits (same lesson learned earlier with BSC/Polygon's
// eth_getLogs caps) ─────────────────────────────────────────────────────────
async function scanEvmRoleEvents(provider, address, chain) {
  const latest = await provider.getBlockNumber();
  const deployBlock = Number(process.env[`${chain}_DEPLOY_BLOCK`] ?? 0);
  let from = deployBlock;
  let chunk = 50_000;
  const all = [];

  while (from <= latest) {
    const to = Math.min(from + chunk - 1, latest);
    try {
      const logs = await provider.getLogs({
        address, fromBlock: from, toBlock: to,
        topics: [[ROLE_GRANTED_TOPIC, ROLE_REVOKED_TOPIC]],
      });
      for (const log of logs) {
        const parsed = ROLE_EVENTS_IFACE.parseLog(log);
        if (!parsed) continue;
        all.push({
          type: parsed.name === 'RoleGranted' ? 'GRANT' : 'REVOKE',
          role: parsed.args.role.toLowerCase(),
          account: parsed.args.account.toLowerCase(),
          blockNumber: log.blockNumber,
        });
      }
      from = to + 1;
    } catch (err) {
      const msg = String(err?.error?.message ?? err?.shortMessage ?? err?.message ?? '');
      if (/block range|limit exceeded|too many|range limit/i.test(msg) && chunk > 500) {
        chunk = Math.floor(chunk / 4);
        continue; // retry same `from` with a smaller chunk
      }
      throw err;
    }
    await sleep(150); // be polite to public RPCs
  }
  return all.sort((a, b) => a.blockNumber - b.blockNumber);
}

// ── TRON: TronGrid's paginated events API ───────────────────────────────────
async function scanTronRoleEvents(rpcBase, address) {
  const events = [];
  for (const eventName of ['RoleGranted', 'RoleRevoked']) {
    let url = `${rpcBase}/v1/contracts/${address}/events?event_name=${eventName}&limit=200&order_by=block_timestamp,asc`;
    while (url) {
      const res  = await fetch(url);
      const json = await res.json();
      if (!json.success && !json.data) throw new Error(`TronGrid events query failed: ${JSON.stringify(json)}`);
      for (const ev of json.data ?? []) {
        const role    = ('0x' + String(ev.result?.role ?? ev.result?.[0] ?? '').replace(/^0x/, '')).toLowerCase();
        const account = String(ev.result?.account ?? ev.result?.[1] ?? '');
        events.push({
          type: eventName === 'RoleGranted' ? 'GRANT' : 'REVOKE',
          role,
          account, // TRON hex account, normalized to base58 later
          blockNumber: ev.block_timestamp, // events aren't block-numbered here; timestamp orders fine
        });
      }
      url = json.meta?.links?.next ?? null;
    }
  }
  return events.sort((a, b) => a.blockNumber - b.blockNumber);
}

function reduceToCurrentHolders(events) {
  const current = new Map(); // `${role}:${account}` -> boolean
  for (const ev of events) {
    current.set(`${ev.role}:${ev.account}`, ev.type === 'GRANT');
  }
  const held = {}; // role -> Set(account)
  for (const [key, isHeld] of current.entries()) {
    if (!isHeld) continue;
    const [role, account] = key.split(':');
    held[role] = held[role] ?? new Set();
    held[role].add(account);
  }
  return held;
}

async function auditEvmContract(chain, provider, contractType, address) {
  const roleMap = roleHashesFor(contractType);
  console.log(`\n  ${contractType.label} — ${address}`);

  let events;
  try {
    events = await scanEvmRoleEvents(provider, address, chain);
  } catch (err) {
    console.log(`    ! could not scan role events: ${err.message}`);
    return;
  }

  const held = reduceToCurrentHolders(events);
  const contract = new ethers.Contract(address, HAS_ROLE_ABI_HUMAN, provider);

  if (Object.keys(held).length === 0) {
    console.log('    (no RoleGranted events found)');
    return;
  }

  for (const [roleHash, accounts] of Object.entries(held)) {
    const roleName = roleMap[roleHash] ?? roleHash;
    console.log(`    ${roleName}:`);
    for (const account of accounts) {
      let confirmed = 'unknown';
      try { confirmed = await contract.hasRole(roleHash, account); } catch {}
      console.log(`      ${account}  ${confirmed === true ? '✓' : confirmed === false ? '✗ (stale — since revoked)' : '? could not verify'}`);
    }
  }
}

async function auditTronContract(rpcBase, tronWeb, contractType, address) {
  const roleMap = roleHashesFor(contractType);
  console.log(`\n  ${contractType.label} — ${address}`);

  let events;
  try {
    events = await scanTronRoleEvents(rpcBase, address);
  } catch (err) {
    console.log(`    ! could not scan role events: ${err.message}`);
    return;
  }

  // Normalize TRON hex accounts to base58 for display + hasRole() calls.
  for (const ev of events) {
    try {
      const hex = ev.account.replace(/^0x/, '');
      const withPrefix = hex.length === 40 ? '41' + hex : hex;
      ev.account = tronWeb.address.fromHex(withPrefix);
    } catch { /* leave as-is if it doesn't parse */ }
  }

  const held = reduceToCurrentHolders(events);
  const contract = tronWeb.contract(HAS_ROLE_ABI_JSON, address);

  if (Object.keys(held).length === 0) {
    console.log('    (no RoleGranted events found)');
    return;
  }

  for (const [roleHash, accounts] of Object.entries(held)) {
    const roleName = roleMap[roleHash] ?? roleHash;
    console.log(`    ${roleName}:`);
    for (const account of accounts) {
      let confirmed = 'unknown';
      try { confirmed = await contract.hasRole(roleHash, account).call(); } catch {}
      console.log(`      ${account}  ${confirmed === true ? '✓' : confirmed === false ? '✗ (stale — since revoked)' : '? could not verify'}`);
    }
  }
}

async function main() {
  for (const chain of ALL_CHAINS) {
    const rpcUrl = process.env[`${chain}_RPC`];
    if (!rpcUrl) {
      console.log(`\n=== ${chain}: skipped (no ${chain}_RPC set) ===`);
      continue;
    }

    console.log(`\n=== ${chain} ===`);

    if (chain === 'TRON') {
      const tronWeb = new TronWeb({ fullHost: rpcUrl });
      for (const contractType of CONTRACT_TYPES) {
        const address = process.env[`TRON_${contractType.key}_ADDRESS`];
        if (!address) { console.log(`\n  ${contractType.label} — not configured, skipping`); continue; }
        await auditTronContract(rpcUrl, tronWeb, contractType, address);
      }
      continue;
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    for (const contractType of CONTRACT_TYPES) {
      const address = process.env[`${chain}_${contractType.key}_ADDRESS`];
      if (!address) { console.log(`\n  ${contractType.label} — not configured, skipping`); continue; }
      await auditEvmContract(chain, provider, contractType, address);
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});