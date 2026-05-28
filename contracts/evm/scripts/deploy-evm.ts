// contracts/evm/scripts/deploy-evm.ts
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=== EVM Deployment ===");
  console.log("Network:  ", network.name);
  console.log("Chain ID: ", network.chainId.toString());
  console.log("Deployer: ", deployer.address);
  console.log("Balance:  ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("");

  // ── Validate signers ────────────────────────────────────────────
  const MULTISIG_SIGNERS = [
    process.env.SIGNER_1!,
    process.env.SIGNER_2!,
    process.env.SIGNER_3!,
  ];
  if (MULTISIG_SIGNERS.some(s => !s || !ethers.isAddress(s))) {
    throw new Error("SIGNER_1, SIGNER_2, SIGNER_3 must be set in .env and be valid addresses");
  }

  const REQUIRED_SIGS = 2;

  // ── Mint caps ───────────────────────────────────────────────────
  const INRX_MINT_CAP  = ethers.parseUnits("1000000000", 6);  // 1B INRX
  const EGOLD_MINT_CAP = ethers.parseUnits("1000000",    6);  // 1M grams
  const ESLVR_MINT_CAP = ethers.parseUnits("1000000000", 6);  // 1B grams

  // Gold price: ₹5900 per gram (6 decimal places → 5900 * 10^6)
  const GOLD_INITIAL_PRICE   = ethers.parseUnits("5900",  6);
  // Silver price: ₹75 per gram
  const SILVER_INITIAL_PRICE = ethers.parseUnits("75",    6);

  // ── 1. Deploy INRX (UUPS upgradeable proxy) ─────────────────────
  console.log("Deploying INRX...");
  const INRX = await ethers.getContractFactory("INRX");
  const inrx = await upgrades.deployProxy(
    INRX,
    [
      deployer.address,  // defaultAdmin
      deployer.address,  // minter (will transfer to treasury after)
      deployer.address,  // treasury role
      INRX_MINT_CAP,
    ],
    { initializer: "initialize", kind: "uups" }
  );
  await inrx.waitForDeployment();
  const inrxAddress = await inrx.getAddress();
  console.log("✓ INRX proxy:", inrxAddress);

  // ── 2. Deploy EGold (UUPS upgradeable proxy) ────────────────────
  console.log("\nDeploying EGold...");
  const EGold = await ethers.getContractFactory("EGold");
  const egold = await upgrades.deployProxy(
    EGold,
    [
      deployer.address,   // admin
      deployer.address,   // minter
      EGOLD_MINT_CAP,
      GOLD_INITIAL_PRICE,
    ],
    { initializer: "initialize", kind: "uups" }
  );
  await egold.waitForDeployment();
  const egoldAddress = await egold.getAddress();
  console.log("✓ EGold proxy:", egoldAddress);

  // ── 3. Deploy ESilver (UUPS upgradeable proxy) ──────────────────
  console.log("\nDeploying ESilver...");
  const ESilver = await ethers.getContractFactory("ESilver");
  const eslvr = await upgrades.deployProxy(
    ESilver,
    [
      deployer.address,    // admin
      deployer.address,    // minter
      ESLVR_MINT_CAP,
      SILVER_INITIAL_PRICE,
    ],
    { initializer: "initialize", kind: "uups" }
  );
  await eslvr.waitForDeployment();
  const eslvrAddress = await eslvr.getAddress();
  console.log("✓ ESilver proxy:", eslvrAddress);

  // ── 4. Deploy Treasury (multi-sig, controls INRX mint/burn) ─────
  console.log("\nDeploying Treasury for INRX...");
  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(
    inrxAddress,
    MULTISIG_SIGNERS,
    REQUIRED_SIGS,
  );
  await treasury.waitForDeployment();
  const treasuryAddress = await treasury.getAddress();
  console.log("✓ Treasury:", treasuryAddress);

  // ── 5. Deploy Bridge ─────────────────────────────────────────────
  console.log("\nDeploying StablecoinBridge...");
  const Bridge = await ethers.getContractFactory("StablecoinBridge");
  const bridge = await Bridge.deploy(
    inrxAddress,
    MULTISIG_SIGNERS,
    REQUIRED_SIGS,
    network.chainId,
  );
  await bridge.waitForDeployment();
  const bridgeAddress = await bridge.getAddress();
  console.log("✓ Bridge:", bridgeAddress);

  // ── Post-deploy configuration ────────────────────────────────────
  console.log("\n=== Configuring roles ===");

  const MINTER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));

  // Treasury gets MINTER + BURNER on INRX
  console.log("Granting MINTER_ROLE to Treasury on INRX...");
  await (await inrx.grantRole(MINTER_ROLE, treasuryAddress)).wait();

  console.log("Granting BURNER_ROLE to Treasury on INRX...");
  await (await inrx.grantRole(BURNER_ROLE, treasuryAddress)).wait();

  // Bridge gets MINTER + BURNER on all 3 tokens
  // (bridge mints on destination chain, burns on source chain)
  console.log("Granting MINTER_ROLE to Bridge on INRX...");
  await (await inrx.grantRole(MINTER_ROLE, bridgeAddress)).wait();

  console.log("Granting MINTER_ROLE to Bridge on EGold...");
  await (await egold.grantRole(MINTER_ROLE, bridgeAddress)).wait();

  console.log("Granting MINTER_ROLE to Bridge on ESilver...");
  await (await eslvr.grantRole(MINTER_ROLE, bridgeAddress)).wait();

  console.log("✓ All roles configured");

  // ── Save deployment output ────────────────────────────────────────
  const deploymentOutput = {
    network:    network.name,
    chainId:    network.chainId.toString(),
    deployedBy: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      INRX:    inrxAddress,
      EGold:   egoldAddress,
      ESilver: eslvrAddress,
      Treasury: treasuryAddress,
      Bridge:   bridgeAddress,
    },
  };

  const outDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deploymentOutput, null, 2));

  console.log("\n=== Deployment Complete ===");
  console.log(JSON.stringify(deploymentOutput, null, 2));
  console.log(`\nSaved to: ${outFile}`);
  console.log("\nCopy these into your .env:");
  console.log(`${network.name.toUpperCase()}_INRX_ADDRESS=${inrxAddress}`);
  console.log(`${network.name.toUpperCase()}_EGOLD_ADDRESS=${egoldAddress}`);
  console.log(`${network.name.toUpperCase()}_ESLVR_ADDRESS=${eslvrAddress}`);
  console.log(`${network.name.toUpperCase()}_TREASURY_ADDRESS=${treasuryAddress}`);
  console.log(`${network.name.toUpperCase()}_BRIDGE_ADDRESS=${bridgeAddress}`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});