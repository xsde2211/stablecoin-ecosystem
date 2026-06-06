import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

console.log(process.env.SIGNER_1_ADDRESS);
console.log(process.env.SIGNER_2_ADDRESS);
console.log(process.env.SIGNER_3_ADDRESS);
// ─── Token IDs (match what contracts use) ─────────────────────────────────
const TOKEN_INRX  = ethers.keccak256(ethers.toUtf8Bytes("INRX"));
const TOKEN_EGOLD = ethers.keccak256(ethers.toUtf8Bytes("EGOLD"));
const TOKEN_ESLVR = ethers.keccak256(ethers.toUtf8Bytes("ESLVR"));

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║    EVM V2 Deployment — Full Suite            ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("Network:  ", network.name, `(chainId: ${network.chainId})`);
  console.log("Deployer: ", deployer.address);
  console.log("Balance:  ",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("");

  // ─── Validate env ────────────────────────────────────────────────────────
  const SIGNER_1   = process.env.SIGNER_1_ADDRESS!;
  const SIGNER_2   = process.env.SIGNER_2_ADDRESS!;
  const SIGNER_3   = process.env.SIGNER_3_ADDRESS!;
  const GUARDIAN   = process.env.GUARDIAN_ADDRESS   || deployer.address;
  const RELAYER    = process.env.RELAYER_ADDRESS     || deployer.address;
  const VALIDATOR_1= process.env.VALIDATOR_1_ADDRESS || deployer.address;
  const VALIDATOR_2= process.env.VALIDATOR_2_ADDRESS || deployer.address;
  const VALIDATOR_3= process.env.VALIDATOR_3_ADDRESS || deployer.address;
  const CUSTODIAN  = process.env.CUSTODIAN_ADDRESS   || deployer.address;
  const AUDITOR    = process.env.AUDITOR_ADDRESS     || deployer.address;
  const ORACLE_1   = process.env.ORACLE_1_ADDRESS    || deployer.address;
  const ORACLE_2   = process.env.ORACLE_2_ADDRESS    || deployer.address;
  const FREEZER     = process.env.FREEZER_ROLE_ADDRESS     || deployer.address;
  const BLACKLISTER = process.env.BLACKLISTER_ROLE_ADDRESS || deployer.address;

  const signers = [SIGNER_1, SIGNER_2, SIGNER_3];
  if (signers.some(s => !s || !ethers.isAddress(s))) {
    throw new Error("SIGNER_1_ADDRESS, SIGNER_2_ADDRESS, SIGNER_3_ADDRESS must be valid addresses in .env");
  }

  const REQUIRED_SIGS         = 2;
  const REQUIRED_VALIDATORS   = 2;
  const TIMELOCK_DELAY        = 12 * 3600; // 12 hours in seconds

  // ─── Mint caps ──────────────────────────────────────────────────────────
  const INRX_MINT_CAP  = ethers.parseUnits("1000000000", 6);  // 1 billion INRX
  const EGOLD_MINT_CAP = ethers.parseUnits("1000000",    6);  // 1 million grams
  const ESLVR_MINT_CAP = ethers.parseUnits("1000000000", 6);  // 1 billion grams

  // Gold ~ ₹5,900/gram, Silver ~ ₹75/gram (initial prices)
  const GOLD_INITIAL_PRICE   = ethers.parseUnits("5900", 6);
  const SILVER_INITIAL_PRICE = ethers.parseUnits("75",   6);

  // ─── Daily mint limits (optional — can be 0 to disable) ─────────────────
  const INRX_DAILY_MINT  = ethers.parseUnits("10000000", 6);  // 10M INRX/day
  const EGOLD_DAILY_MINT = ethers.parseUnits("1000",     6);  // 1000 grams/day
  const ESLVR_DAILY_MINT = ethers.parseUnits("100000",   6);  // 100k grams/day

  const deployed: Record<string, string> = {};

  // ╔══════════════════════════════════════════════╗
  // ║  1. Deploy Token Contracts                   ║
  // ╚══════════════════════════════════════════════╝

  console.log("\n[1/6] Deploying token contracts...");

  // INRX — UUPS upgradeable proxy
  console.log("  Deploying INRX...");
  const INRX_F = await ethers.getContractFactory("INRX");
  const inrx   = await upgrades.deployProxy(
    INRX_F,
    [deployer.address, deployer.address, deployer.address, INRX_MINT_CAP],
    { initializer: "initialize", kind: "uups" }
  );
  await inrx.waitForDeployment();
  deployed.INRX = await inrx.getAddress();
  console.log("  ✓ INRX:", deployed.INRX);

  // EGold — UUPS upgradeable proxy
  console.log("  Deploying EGold...");
  const EGold_F = await ethers.getContractFactory("EGold");
  const egold   = await upgrades.deployProxy(
    EGold_F,
    [deployer.address, deployer.address, deployer.address, EGOLD_MINT_CAP, GOLD_INITIAL_PRICE],
    { initializer: "initialize", kind: "uups" }
  );
  await egold.waitForDeployment();
  deployed.EGold = await egold.getAddress();
  console.log("  ✓ EGold:", deployed.EGold);

  // ESilver — UUPS upgradeable proxy
  console.log("  Deploying ESilver...");
  const ESilver_F = await ethers.getContractFactory("ESilver");
  const eslvr     = await upgrades.deployProxy(
    ESilver_F,
    [deployer.address, deployer.address, deployer.address, ESLVR_MINT_CAP, SILVER_INITIAL_PRICE],
    { initializer: "initialize", kind: "uups" }
  );
  await eslvr.waitForDeployment();
  deployed.ESilver = await eslvr.getAddress();
  console.log("  ✓ ESilver:", deployed.ESilver);

  // ╔══════════════════════════════════════════════╗
  // ║  2. Deploy OracleManager                     ║
  // ╚══════════════════════════════════════════════╝

  console.log("\n[2/6] Deploying OracleManager...");
  const Oracle_F  = await ethers.getContractFactory("OracleManager");
  const oracleMgr:any = await Oracle_F.deploy(deployer.address);
  await oracleMgr.waitForDeployment();
  deployed.OracleManager = await oracleMgr.getAddress();
  console.log("  ✓ OracleManager:", deployed.OracleManager);

  // Register oracles for EGold and ESilver
  // registerOracle() already grants ORACLE_ROLE internally — no separate grantRole needed
  console.log("  Registering oracles...");
  await (await oracleMgr.registerOracle(TOKEN_EGOLD, ORACLE_1, "Primary Gold Oracle")).wait();
  await (await oracleMgr.registerOracle(TOKEN_EGOLD, ORACLE_2, "Secondary Gold Oracle")).wait();
  await (await oracleMgr.registerOracle(TOKEN_ESLVR, ORACLE_1, "Primary Silver Oracle")).wait();
  await (await oracleMgr.registerOracle(TOKEN_ESLVR, ORACLE_2, "Secondary Silver Oracle")).wait();
  console.log("  ✓ Oracles registered (ORACLE_ROLE granted automatically)");

  // Set initial prices using ORACLE_1 as the signer
  // ORACLE_1 must be a wallet you control — set ORACLE_1_ADDRESS=your_wallet in .env
  // and ensure its private key is available as ORACLE_1_PRIVATE_KEY
  const oracle1Signer = process.env.ORACLE_1_PRIVATE_KEY
    ? new ethers.Wallet(process.env.ORACLE_1_PRIVATE_KEY, ethers.provider)
    : deployer; // fallback: deployer if ORACLE_1 is same wallet

  // If deployer is being used as ORACLE_1, it must have been registered above
  // (i.e. ORACLE_1_ADDRESS === deployer.address)
  if (oracle1Signer.address.toLowerCase() !== ORACLE_1.toLowerCase()) {
    throw new Error(
      `ORACLE_1_PRIVATE_KEY does not match ORACLE_1_ADDRESS.\n` +
      `Expected: ${ORACLE_1}\n` +
      `Got:      ${oracle1Signer.address}\n` +
      `Either set ORACLE_1_PRIVATE_KEY in .env or set ORACLE_1_ADDRESS=${deployer.address}`
    );
  }

  await (await oracleMgr.connect(oracle1Signer).updatePrice(TOKEN_EGOLD, GOLD_INITIAL_PRICE)).wait();
  await (await oracleMgr.connect(oracle1Signer).updatePrice(TOKEN_ESLVR, SILVER_INITIAL_PRICE)).wait();
  console.log("  ✓ Initial prices set via registered oracle:", oracle1Signer.address);

  // ╔══════════════════════════════════════════════╗
  // ║  3. Deploy ReserveVault                      ║
  // ╚══════════════════════════════════════════════╝

  console.log("\n[3/6] Deploying ReserveVault...");
  const Reserve_F  = await ethers.getContractFactory("ReserveVault");
  const reserveVault = await Reserve_F.deploy(deployer.address);
  await reserveVault.waitForDeployment();
  deployed.ReserveVault = await reserveVault.getAddress();
  console.log("  ✓ ReserveVault:", deployed.ReserveVault);

  // Register token contracts in ReserveVault for supply reading
  await (await reserveVault.setTokenContract(TOKEN_INRX,  deployed.INRX)).wait();
  await (await reserveVault.setTokenContract(TOKEN_EGOLD, deployed.EGold)).wait();
  await (await reserveVault.setTokenContract(TOKEN_ESLVR, deployed.ESilver)).wait();

  // Grant custodian and auditor roles
  const CUSTODIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CUSTODIAN_ROLE"));
  const AUDITOR_ROLE   = ethers.keccak256(ethers.toUtf8Bytes("AUDITOR_ROLE"));
  await (await reserveVault.grantRole(CUSTODIAN_ROLE, CUSTODIAN)).wait();
  await (await reserveVault.grantRole(AUDITOR_ROLE,   AUDITOR)).wait();
  console.log("  ✓ Roles configured");

  // ╔══════════════════════════════════════════════╗
  // ║  4. Deploy TreasuryTimelock                  ║
  // ╚══════════════════════════════════════════════╝

  console.log("\n[4/6] Deploying TreasuryTimelock...");
  const Treasury_F   = await ethers.getContractFactory("TreasuryTimelock");
  const treasury     = await Treasury_F.deploy(
    signers,
    REQUIRED_SIGS,
    TIMELOCK_DELAY,
    GUARDIAN
  );
  await treasury.waitForDeployment();
  deployed.TreasuryTimelock = await treasury.getAddress();
  console.log("  ✓ TreasuryTimelock:", deployed.TreasuryTimelock);

  // Register all 3 tokens in treasury
  await (await treasury.registerToken(TOKEN_INRX,  deployed.INRX)).wait();
  await (await treasury.registerToken(TOKEN_EGOLD, deployed.EGold)).wait();
  await (await treasury.registerToken(TOKEN_ESLVR, deployed.ESilver)).wait();

  // Set daily mint limits
  await (await treasury.setDailyMintLimit(TOKEN_INRX,  INRX_DAILY_MINT)).wait();
  await (await treasury.setDailyMintLimit(TOKEN_EGOLD, EGOLD_DAILY_MINT)).wait();
  await (await treasury.setDailyMintLimit(TOKEN_ESLVR, ESLVR_DAILY_MINT)).wait();
  console.log("  ✓ Daily limits set");


  // ╔══════════════════════════════════════════════╗
  // ║  5. Deploy StablecoinBridgeV2               ║
  // ╚══════════════════════════════════════════════╝

  console.log("\n[5/6] Deploying StablecoinBridgeV2...");
  const validators = [VALIDATOR_1, VALIDATOR_2, VALIDATOR_3];
  const Bridge_F   = await ethers.getContractFactory("StablecoinBridgeV2");
  const bridge     = await Bridge_F.deploy(
    validators,
    REQUIRED_VALIDATORS,
    network.chainId,
    deployer.address
  );
  await bridge.waitForDeployment();
  deployed.BridgeV2 = await bridge.getAddress();
  console.log("  ✓ StablecoinBridgeV2:", deployed.BridgeV2);

  // Register all tokens in bridge
  await (await bridge.registerToken(TOKEN_INRX,  deployed.INRX)).wait();
  await (await bridge.registerToken(TOKEN_EGOLD, deployed.EGold)).wait();
  await (await bridge.registerToken(TOKEN_ESLVR, deployed.ESilver)).wait();

  // Add relayer
  await (await bridge.addRelayer(RELAYER)).wait();
  console.log("  ✓ Relayer added:", RELAYER);

  // ╔══════════════════════════════════════════════╗
  // ║  6. Configure Token Roles                   ║
  // ╚══════════════════════════════════════════════╝

  console.log("\n[6/6] Configuring token roles...");

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
  const FREEZER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FREEZER_ROLE"));
  const BLACKLISTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BLACKLISTER_ROLE"));
  const TREASURY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("TREASURY_ROLE"));

  // TreasuryTimelock gets MINTER + BURNER on all tokens
  // (treasury proposes → timelock delay → executes mint/burn)
  for (const [token, contract] of [
    [inrx,  "INRX"],
    [egold, "EGold"],
    [eslvr, "ESilver"],
  ] as const) {
    await (await (token as any).grantRole(MINTER_ROLE, deployed.TreasuryTimelock)).wait();
    await (await (token as any).grantRole(BURNER_ROLE, deployed.TreasuryTimelock)).wait();
    await (await (token as any).grantRole(TREASURY_ROLE,deployed.TreasuryTimelock)).wait();

    await (await (token as any).grantRole(MINTER_ROLE, deployed.BridgeV2)).wait();
    await (await (token as any).grantRole(BURNER_ROLE, deployed.BridgeV2)).wait();

    await (await (token as any).grantRole(FREEZER_ROLE,FREEZER)).wait();
    await (await (token as any).grantRole(BLACKLISTER_ROLE,BLACKLISTER)).wait();

    console.log(`  ✓ ${contract}: Treasury(MINTER+BURNER+TREASURY), Bridge(MINTER+BURNER), FREEZER=${FREEZER}, BLACKLISTER=${BLACKLISTER}`);
  }

  // ─── Save deployment output ────────────────────────────────────────────

  const output = {
    network:    network.name,
    chainId:    network.chainId.toString(),
    deployedBy: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts:  deployed,
    roles: {
      signers,
      guardian:  GUARDIAN,
      relayer:   RELAYER,
      validators: [VALIDATOR_1, VALIDATOR_2, VALIDATOR_3],
      custodian: CUSTODIAN,
      auditor:   AUDITOR,
      oracles:   [ORACLE_1, ORACLE_2],
    },
    config: {
      requiredSignatures:  REQUIRED_SIGS,
      requiredValidators:  REQUIRED_VALIDATORS,
      timelockDelayHours:  12,
    }
  };

  const outDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${network.name}-v2.json`);
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║           Deployment Complete ✓              ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(JSON.stringify(deployed, null, 2));
  console.log(`\nSaved to: ${outFile}`);

  // Print .env additions
  console.log("\n# ─── Add these to your root .env ───────────────────────────");
  const prefix = network.name.toUpperCase();
  console.log(`${prefix}_INRX_ADDRESS=${deployed.INRX}`);
  console.log(`${prefix}_EGOLD_ADDRESS=${deployed.EGold}`);
  console.log(`${prefix}_ESLVR_ADDRESS=${deployed.ESilver}`);
  console.log(`${prefix}_ORACLE_MANAGER_ADDRESS=${deployed.OracleManager}`);
  console.log(`${prefix}_RESERVE_VAULT_ADDRESS=${deployed.ReserveVault}`);
  console.log(`${prefix}_TREASURY_TIMELOCK_ADDRESS=${deployed.TreasuryTimelock}`);
  console.log(`${prefix}_BRIDGE_V2_ADDRESS=${deployed.BridgeV2}`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
