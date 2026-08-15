const { TronWeb } = require('tronweb');
const { ethers }  = require('ethers');
const fs          = require('fs');
const path        = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// ─── TronWeb setup ────────────────────────────────────────────────────────────
const tronWeb = new TronWeb({
  fullHost:   process.env.TRON_RPC || 'https://nile.trongrid.io',
  privateKey: process.env.DEPLOYER_TRON_PRIVATE_KEY,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadArtifact(name) {
  const p = path.join(__dirname, '../build/contracts', `${name}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Build artifact not found: ${p}\n` +
      `Run: pnpm --filter @ecosystem/contracts-tron compile`
    );
  }
  const a = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { abi: a.abi, bytecode: a.bytecode };
}

async function deploy(name, params = []) {
  console.log(`\n  Deploying ${name}...`);
  const { abi, bytecode } = loadArtifact(name);
  const contract = await tronWeb.contract().new({
    abi,
    bytecode,
    feeLimit:   1_000_000_000,
    callValue:  0,
    parameters: params,
  });
  const addr = contract.address;
  console.log(`  ✓ ${name}: ${addr}`);
  return { contract, address: addr };
}

// Deploys `implName`'s implementation, then an EcosystemProxy in front of it
// with initialize(...initArgs) encoded as the proxy's own constructor data.
// The proxy's constructor performs the initialize() delegatecall as part of
// the SAME deployment transaction — deployment and initialization happen
// atomically, so there is no separate "Initialize" transaction to forget,
// front-run, or have silently fail against an already-locked implementation
// (which is exactly what happened before: the implementation's own
// constructor calls _disableInitializers(), so calling initialize()
// directly on it — as a second, separate transaction — was *always* going
// to revert with "Initializable: contract is already initialized").
//
// Returns a contract instance bound to the PROXY's address but using the
// IMPLEMENTATION's ABI — this is the address every other file in the repo
// (deploy script itself, wallet-service, stablecoin-service, .env) should
// use from now on. The raw implementation address is still returned too,
// purely for reference/verification — never register it anywhere as "the"
// contract address.

// ethers has no concept of Tron's base58 address format (T...) — it only
// understands EVM-style 0x + 40 hex chars. TronWeb's own .new({parameters})
// converts base58 addresses to EVM-hex internally before ABI-encoding
// constructor args, which is why the plain (non-upgradeable) deploys in
// this script always worked — but building the initialize() calldata by
// hand with ethers.Interface (needed for the atomic proxy-init trick)
// bypasses TronWeb's conversion entirely, so every address has to be
// converted here first or ethers throws "invalid address".
function toEvmAddress(addr) {
  if (typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr)) return addr; // already EVM-hex
  const hex = tronWeb.address.toHex(addr); // "41" + 40 hex chars, no 0x prefix
  return '0x' + hex.slice(2);              // drop Tron's "41" prefix, add "0x"
}

// Walks the initialize() ABI and converts only the address / address[]
// positions — every other arg type (uint256, string, etc.) passes through
// unchanged.
function convertInitArgsForEncoding(abi, args) {
  const initFn = abi.find(f => f.type === 'function' && f.name === 'initialize');
  if (!initFn) throw new Error('No initialize() function found in ABI');
  return initFn.inputs.map((input, i) => {
    const val = args[i];
    if (input.type === 'address')   return toEvmAddress(val);
    if (input.type === 'address[]') return val.map(toEvmAddress);
    return val;
  });
}

async function deployUpgradeable(implName, initArgs) {
  console.log(`\n  Deploying ${implName} (implementation)...`);
  const impl = loadArtifact(implName);
  const implContract = await tronWeb.contract().new({
    abi: impl.abi, bytecode: impl.bytecode,
    feeLimit: 1_000_000_000, callValue: 0, parameters: [],
  });
  console.log(`  ✓ ${implName} implementation: ${implContract.address}`);
  await wait();

  const iface         = new ethers.Interface(impl.abi);
  const encodableArgs = convertInitArgsForEncoding(impl.abi, initArgs);
  const initData       = iface.encodeFunctionData('initialize', encodableArgs);

  const proxyArtifact = loadArtifact('EcosystemProxy');
  console.log(`  Deploying ${implName} proxy (init happens in this same tx)...`);
  const proxyContract = await tronWeb.contract().new({
    abi: proxyArtifact.abi, bytecode: proxyArtifact.bytecode,
    feeLimit: 1_000_000_000, callValue: 0,
    parameters: [implContract.address, initData],
  });
  console.log(`  ✓ ${implName} proxy (USE THIS ADDRESS EVERYWHERE): ${proxyContract.address}`);
  await wait();

  const proxied = await tronWeb.contract(impl.abi, proxyContract.address);
  return {
    address:               proxyContract.address,
    implementationAddress: implContract.address,
    contract:              proxied,
  };
}

// Wait between txs — TRON needs ~3s for confirmation
const wait = (ms = 3000) => new Promise(r => setTimeout(r, ms));

// keccak256 role helper — matches what OpenZeppelin produces
function role(name) {
  return tronWeb.sha3(name).slice(0, 66); // returns 0x + 64 hex chars
}

// ─── Env validation ───────────────────────────────────────────────────────────
function requireEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const deployer = tronWeb.defaultAddress.base58;

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   TRON Nile Deployment — Full Suite          ║');
  console.log('║   (every contract behind an upgradeable      ║');
  console.log('║    proxy, initialized atomically)            ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('Network:  ', process.env.TRON_RPC);
  console.log('Deployer: ', deployer);
  console.log('');

  // ─── Role addresses from env ────────────────────────────────────────────────
  const TRON_SIGNER_1   = requireEnv('TRON_SIGNER_1_ADDRESS');
  const TRON_SIGNER_2   = requireEnv('TRON_SIGNER_2_ADDRESS');
  const TRON_SIGNER_3   = requireEnv('TRON_SIGNER_3_ADDRESS');
  const TRON_GUARDIAN   = process.env.TRON_GUARDIAN_ADDRESS   || deployer;
  const TRON_BLACKLISTER= process.env.TRON_BLACKLISTER_ADDRESS|| deployer;
  const TRON_FREEZER    = process.env.TRON_FREEZER_ADDRESS    || deployer;
  const TRON_CUSTODIAN  = process.env.TRON_CUSTODIAN_ADDRESS  || deployer;
  const TRON_AUDITOR    = process.env.TRON_AUDITOR_ADDRESS    || deployer;
  const TRON_ORACLE_1   = process.env.TRON_ORACLE_1_ADDRESS   || deployer;
  const TRON_ORACLE_2   = process.env.TRON_ORACLE_2_ADDRESS   || deployer;
  const TRON_RELAYER    = process.env.RELAYER_TRON_ADDRESS    || deployer;

  const VALIDATOR_LIST = [
    process.env.TRON_VALIDATOR_1_ADDRESS || deployer,
    process.env.TRON_VALIDATOR_2_ADDRESS || deployer,
    process.env.TRON_VALIDATOR_3_ADDRESS || deployer,
  ];
  const REQUIRED_VALIDATORS = parseInt(process.env.REQUIRED_VALIDATORS || '2');
  const REQUIRED_SIGS       = parseInt(process.env.REQUIRED_SIGS       || '2');
  const TIMELOCK_DELAY      = parseInt(process.env.TIMELOCK_DELAY_SECONDS || String(12 * 3600));

  // ─── Mint caps & prices (6 decimals) ────────────────────────────────────────
  const INRX_MINT_CAP  = '1000000000000000'; // 1B INRX
  const EGOLD_MINT_CAP = '1000000000000';    // 1M grams
  const ESLVR_MINT_CAP = '1000000000000000'; // 1B grams
  const GOLD_PRICE     = '5900000000';       // ₹5,900/gram
  const SILVER_PRICE   = '75000000';         // ₹75/gram

  // ─── Daily bridge limits ────────────────────────────────────────────────────
  const DAILY_LIMIT_INRX  = process.env.TRON_DAILY_LIMIT_INRX  || '10000000000000'; // 10M INRX
  const DAILY_LIMIT_EGOLD = process.env.TRON_DAILY_LIMIT_EGOLD || '1000000000';     // 1000 grams
  const DAILY_LIMIT_ESLVR = process.env.TRON_DAILY_LIMIT_ESLVR || '100000000000';   // 100k grams

  // ─── Role hashes ────────────────────────────────────────────────────────────
  const MINTER_ROLE      = role('MINTER_ROLE');
  const BURNER_ROLE      = role('BURNER_ROLE');
  const FREEZER_ROLE     = role('FREEZER_ROLE');
  const BLACKLISTER_ROLE = role('BLACKLISTER_ROLE');
  const TREASURY_ROLE    = role('TREASURY_ROLE');
  const UPGRADER_ROLE    = role('UPGRADER_ROLE');
  const CUSTODIAN_ROLE   = role('CUSTODIAN_ROLE');
  const AUDITOR_ROLE     = role('AUDITOR_ROLE');
  const ORACLE_ROLE      = role('ORACLE_ROLE');
  const MANAGER_ROLE     = role('MANAGER_ROLE');
  const GUARDIAN_ROLE    = role('GUARDIAN_ROLE');
  const SIGNER_ROLE      = role('SIGNER_ROLE');
  const VALIDATOR_ROLE   = role('VALIDATOR_ROLE');
  const PAUSER_ROLE      = role('PAUSER_ROLE');

  // Token IDs — must match keccak256 of the string
  const TOKEN_INRX  = tronWeb.sha3('INRX').slice(0, 66);
  const TOKEN_EGOLD = tronWeb.sha3('EGOLD').slice(0, 66);
  const TOKEN_ESLVR = tronWeb.sha3('ESLVR').slice(0, 66);

  const deployed       = {};
  const implementations = {};

  // ╔══════════════════════════════════════════════╗
  // ║  1. Deploy INRX / EGold / ESilver             ║
  // ║     (implementation + proxy, atomic init)     ║
  // ╚══════════════════════════════════════════════╝

  console.log('\n[1/7] Deploying token contracts...');

  const { address: inrxAddr, implementationAddress: inrxImpl, contract: inrx } =
    await deployUpgradeable('INRX', [deployer, deployer, deployer, INRX_MINT_CAP]);
  deployed.INRX = inrxAddr;
  implementations.INRX = inrxImpl;

  const { address: egoldAddr, implementationAddress: egoldImpl, contract: egold } =
    await deployUpgradeable('EGold', [deployer, deployer, deployer, EGOLD_MINT_CAP, GOLD_PRICE]);
  deployed.EGold = egoldAddr;
  implementations.EGold = egoldImpl;

  const { address: eslvrAddr, implementationAddress: eslvrImpl, contract: eslvr } =
    await deployUpgradeable('ESilver', [deployer, deployer, deployer, ESLVR_MINT_CAP, SILVER_PRICE]);
  deployed.ESilver = eslvrAddr;
  implementations.ESilver = eslvrImpl;

  console.log('  ✓ All tokens deployed and initialized');

  // ╔══════════════════════════════════════════════╗
  // ║  2. Deploy OracleManager                     ║
  // ╚══════════════════════════════════════════════╝

  console.log('\n[2/7] Deploying OracleManager...');

  const { address: oracleAddr, implementationAddress: oracleImpl, contract: oracleMgr } =
    await deployUpgradeable('OracleManager', [deployer]);
  deployed.OracleManager = oracleAddr;
  implementations.OracleManager = oracleImpl;

  // Register oracle 1 for all tokens
  await oracleMgr.registerOracle(TOKEN_EGOLD, TRON_ORACLE_1, 'Primary Gold Oracle').send({ feeLimit: 200_000_000 });
  console.log('  ✓ Oracle1 registered for EGOLD');
  await wait();

  await oracleMgr.registerOracle(TOKEN_ESLVR, TRON_ORACLE_1, 'Primary Silver Oracle').send({ feeLimit: 200_000_000 });
  console.log('  ✓ Oracle1 registered for ESLVR');
  await wait();

  // Register oracle 2 if different from oracle 1
  if (TRON_ORACLE_2 !== TRON_ORACLE_1) {
    await oracleMgr.registerOracle(TOKEN_EGOLD, TRON_ORACLE_2, 'Secondary Gold Oracle').send({ feeLimit: 200_000_000 });
    console.log('  ✓ Oracle2 registered for EGOLD');
    await wait();

    await oracleMgr.registerOracle(TOKEN_ESLVR, TRON_ORACLE_2, 'Secondary Silver Oracle').send({ feeLimit: 200_000_000 });
    console.log('  ✓ Oracle2 registered for ESLVR');
    await wait();
  }

  // Set initial prices using oracle 1 private key
  const TRON_ORACLE_1_PK = process.env.TRON_ORACLE_1_PRIVATE_KEY;
  if (TRON_ORACLE_1_PK) {
    const oracle1Web = new TronWeb({
      fullHost:   process.env.TRON_RPC,
      privateKey: TRON_ORACLE_1_PK,
    });
    const oracleMgrAsOracle1 = await oracle1Web.contract(
      loadArtifact('OracleManager').abi,
      oracleAddr
    );
    await oracleMgrAsOracle1.updatePrice(TOKEN_EGOLD, GOLD_PRICE).send({ feeLimit: 200_000_000 });
    console.log('  ✓ Initial EGOLD price set');
    await wait();
    await oracleMgrAsOracle1.updatePrice(TOKEN_ESLVR, SILVER_PRICE).send({ feeLimit: 200_000_000 });
    console.log('  ✓ Initial ESLVR price set');
    await wait();
  } else {
    console.log('  ⚠ TRON_ORACLE_1_PRIVATE_KEY not set — skipping initial price');
    console.log('    Set manually after deploy using oracle wallet');
  }

  // Grant MANAGER_ROLE to deployer (already admin, but explicit is cleaner)
  await oracleMgr.grantRole(MANAGER_ROLE, deployer).send({ feeLimit: 200_000_000 });
  await wait();

  console.log('  ✓ OracleManager configured');

  // ╔══════════════════════════════════════════════╗
  // ║  3. Deploy ReserveVault                      ║
  // ╚══════════════════════════════════════════════╝

  console.log('\n[3/7] Deploying ReserveVault...');

  const { address: reserveAddr, implementationAddress: reserveImpl, contract: reserveVault } =
    await deployUpgradeable('ReserveVault', [deployer]);
  deployed.ReserveVault = reserveAddr;
  implementations.ReserveVault = reserveImpl;

  // Register token contracts so ReserveVault can read circulating supply
  await reserveVault.setTokenContract(TOKEN_INRX,  inrxAddr).send({ feeLimit: 200_000_000 });
  await wait();
  await reserveVault.setTokenContract(TOKEN_EGOLD, egoldAddr).send({ feeLimit: 200_000_000 });
  await wait();
  await reserveVault.setTokenContract(TOKEN_ESLVR, eslvrAddr).send({ feeLimit: 200_000_000 });
  await wait();

  // Grant custodian and auditor roles
  await reserveVault.grantRole(CUSTODIAN_ROLE, TRON_CUSTODIAN).send({ feeLimit: 200_000_000 });
  await wait();
  await reserveVault.grantRole(AUDITOR_ROLE, TRON_AUDITOR).send({ feeLimit: 200_000_000 });
  await wait();

  console.log('  ✓ ReserveVault configured');

  // ╔══════════════════════════════════════════════╗
  // ║  4. Deploy TreasuryTimelock                  ║
  // ╚══════════════════════════════════════════════╝

  console.log('\n[4/7] Deploying TreasuryTimelock...');

  const signers = [TRON_SIGNER_1, TRON_SIGNER_2, TRON_SIGNER_3];

  const { address: treasuryAddr, implementationAddress: treasuryImpl, contract: treasury } =
    await deployUpgradeable('TreasuryTimelock', [signers, REQUIRED_SIGS, TIMELOCK_DELAY, TRON_GUARDIAN]);
  deployed.TreasuryTimelock = treasuryAddr;
  implementations.TreasuryTimelock = treasuryImpl;

  // Register all 3 tokens in treasury
  await treasury.registerToken(TOKEN_INRX,  inrxAddr).send({ feeLimit: 200_000_000 });
  await wait();
  await treasury.registerToken(TOKEN_EGOLD, egoldAddr).send({ feeLimit: 200_000_000 });
  await wait();
  await treasury.registerToken(TOKEN_ESLVR, eslvrAddr).send({ feeLimit: 200_000_000 });
  await wait();

  // Set daily mint limits in TreasuryTimelock
  await treasury.setDailyMintLimit(TOKEN_INRX,  '10000000000000').send({ feeLimit: 200_000_000 }); // 10M/day
  await wait();
  await treasury.setDailyMintLimit(TOKEN_EGOLD, '1000000000').send({ feeLimit: 200_000_000 });      // 1000 grams/day
  await wait();
  await treasury.setDailyMintLimit(TOKEN_ESLVR, '100000000000').send({ feeLimit: 200_000_000 });    // 100k grams/day
  await wait();

  console.log('  ✓ TreasuryTimelock configured with daily limits');

  // ╔══════════════════════════════════════════════╗
  // ║  5. Deploy TronBridge                        ║
  // ╚══════════════════════════════════════════════╝

  console.log('\n[5/7] Deploying TronBridge...');

  const { address: bridgeAddr, implementationAddress: bridgeImpl, contract: bridge } =
    await deployUpgradeable('TronBridge', [REQUIRED_VALIDATORS, VALIDATOR_LIST, deployer]);
  deployed.TronBridge = bridgeAddr;
  implementations.TronBridge = bridgeImpl;

  // Register tokens in bridge
  await bridge.registerToken('INRX',  inrxAddr).send({ feeLimit: 200_000_000 });
  await wait();
  await bridge.registerToken('EGOLD', egoldAddr).send({ feeLimit: 200_000_000 });
  await wait();
  await bridge.registerToken('ESLVR', eslvrAddr).send({ feeLimit: 200_000_000 });
  await wait();

  // Add relayer
  await bridge.addRelayer(TRON_RELAYER).send({ feeLimit: 200_000_000 });
  await wait();

  // Set daily bridge limits per token
  await bridge.setDailyLimit('INRX',  DAILY_LIMIT_INRX).send({ feeLimit: 200_000_000 });
  await wait();
  await bridge.setDailyLimit('EGOLD', DAILY_LIMIT_EGOLD).send({ feeLimit: 200_000_000 });
  await wait();
  await bridge.setDailyLimit('ESLVR', DAILY_LIMIT_ESLVR).send({ feeLimit: 200_000_000 });
  await wait();

  console.log('  ✓ TronBridge configured with daily limits');

  // ╔══════════════════════════════════════════════╗
  // ║  6. Configure token roles                    ║
  // ╚══════════════════════════════════════════════╝

  console.log('\n[6/7] Configuring token roles...');

  for (const [sym, token] of [
    ['INRX',  inrx],
    ['EGOLD', egold],
    ['ESLVR', eslvr],
  ]) {
    // TreasuryTimelock → MINTER + BURNER + TREASURY_ROLE
    await token.grantRole(MINTER_ROLE,   treasuryAddr).send({ feeLimit: 200_000_000 });
    await wait();
    await token.grantRole(BURNER_ROLE,   treasuryAddr).send({ feeLimit: 200_000_000 });
    await wait();
    await token.grantRole(TREASURY_ROLE, treasuryAddr).send({ feeLimit: 200_000_000 });
    await wait();

    // TronBridge → MINTER + BURNER
    await token.grantRole(MINTER_ROLE, bridgeAddr).send({ feeLimit: 200_000_000 });
    await wait();
    await token.grantRole(BURNER_ROLE, bridgeAddr).send({ feeLimit: 200_000_000 });
    await wait();

    // TRON_SIGNER_1 → MINTER + BURNER — mirrors the direct mint/burn bypass
    // signer stablecoin-service uses on the EVM chains (SIGNER_1_ADDRESS).
    // Without this, stablecoin-service's TRON burn/mint calls hit the same
    // "missing role" AccessControl revert you just fixed manually on EVM.
    await token.grantRole(MINTER_ROLE, TRON_SIGNER_1).send({ feeLimit: 200_000_000 });
    await wait();
    await token.grantRole(BURNER_ROLE, TRON_SIGNER_1).send({ feeLimit: 200_000_000 });
    await wait();

    // Compliance roles → designated addresses
    await token.grantRole(BLACKLISTER_ROLE, TRON_BLACKLISTER).send({ feeLimit: 200_000_000 });
    await wait();
    await token.grantRole(FREEZER_ROLE,     TRON_FREEZER).send({ feeLimit: 200_000_000 });
    await wait();

    console.log(`  ✓ ${sym} roles configured`);
  }

  // ╔══════════════════════════════════════════════╗
  // ║  7. Save deployment output                   ║
  // ╚══════════════════════════════════════════════╝

  console.log('\n[7/7] Saving deployment output...');

  const networkName = (process.env.TRON_RPC || '').includes('nile')   ? 'nile'
    : (process.env.TRON_RPC || '').includes('shasta') ? 'shasta'
    : 'mainnet';

  const output = {
    network:    networkName,
    rpc:        process.env.TRON_RPC,
    deployedBy: deployer,
    deployedAt: new Date().toISOString(),
    contracts:  deployed,
    implementations,
    roles: {
      signers:     signers,
      guardian:    TRON_GUARDIAN,
      blacklister: TRON_BLACKLISTER,
      freezer:     TRON_FREEZER,
      custodian:   TRON_CUSTODIAN,
      auditor:     TRON_AUDITOR,
      oracle1:     TRON_ORACLE_1,
      oracle2:     TRON_ORACLE_2,
      relayer:     TRON_RELAYER,
      validators:  VALIDATOR_LIST,
    },
    config: {
      requiredSignatures:  REQUIRED_SIGS,
      requiredValidators:  REQUIRED_VALIDATORS,
      timelockDelaySeconds: TIMELOCK_DELAY,
    },
  };

  const outDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${networkName}.json`),
    JSON.stringify(output, null, 2)
  );

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║   TRON Deployment Complete ✓                 ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('\nProxy addresses (use these):');
  console.log(JSON.stringify(deployed, null, 2));
  console.log('\nImplementation addresses (reference only — do not use directly):');
  console.log(JSON.stringify(implementations, null, 2));

  console.log('\n# ─── Add these to your root .env ───────────────');
  console.log(`TRON_INRX_ADDRESS=${deployed.INRX}`);
  console.log(`TRON_EGOLD_ADDRESS=${deployed.EGold}`);
  console.log(`TRON_ESLVR_ADDRESS=${deployed.ESilver}`);
  console.log(`TRON_ORACLE_MANAGER_ADDRESS=${deployed.OracleManager}`);
  console.log(`TRON_RESERVE_VAULT_ADDRESS=${deployed.ReserveVault}`);
  console.log(`TRON_TREASURY_TIMELOCK_ADDRESS=${deployed.TreasuryTimelock}`);
  console.log(`TRON_BRIDGE_ADDRESS=${deployed.TronBridge}`);
}

main().catch(err => {
  console.error('\n✗ Deployment failed:', err.message ?? err);
  process.exit(1);
});