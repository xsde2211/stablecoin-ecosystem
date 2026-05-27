// contracts/scripts/deploy-evm.ts
import { ethers, upgrades } from "hardhat";
import * as fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const MULTISIG_SIGNERS = [
    process.env.SIGNER_1!,
    process.env.SIGNER_2!,
    process.env.SIGNER_3!,
  ];
  const REQUIRED_SIGS = 2;
  const MINT_CAP = ethers.parseUnits("1000000000", 6); // 1B INRX

  // Deploy INRX (UUPS proxy)
  const INRX = await ethers.getContractFactory("INRX");
  const inrx = await upgrades.deployProxy(
    INRX,
    [deployer.address, deployer.address, deployer.address, MINT_CAP],
    { initializer: "initialize", kind: "uups" }
  );
  await inrx.waitForDeployment();
  console.log("INRX proxy:", await inrx.getAddress());

  // Deploy Treasury (multi-sig)
  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await Treasury.deploy(
    await inrx.getAddress(),
    MULTISIG_SIGNERS,
    REQUIRED_SIGS
  );
  await treasury.waitForDeployment();
  console.log("Treasury:", await treasury.getAddress());

  // Grant MINTER_ROLE to treasury
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  await inrx.grantRole(MINTER_ROLE, await treasury.getAddress());

  // Deploy Bridge
  const Bridge = await ethers.getContractFactory("StablecoinBridge");
  const bridge = await Bridge.deploy(
    await inrx.getAddress(),
    MULTISIG_SIGNERS,
    REQUIRED_SIGS,
    (await ethers.provider.getNetwork()).chainId
  );
  await bridge.waitForDeployment();
  console.log("Bridge:", await bridge.getAddress());

  // Save addresses
  const addresses = {
    chain: (await ethers.provider.getNetwork()).name,
    inrx: await inrx.getAddress(),
    treasury: await treasury.getAddress(),
    bridge: await bridge.getAddress(),
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    `deployments/${addresses.chain}.json`,
    JSON.stringify(addresses, null, 2)
  );
  console.log("Deployment complete:", addresses);
}

main().catch(console.error);