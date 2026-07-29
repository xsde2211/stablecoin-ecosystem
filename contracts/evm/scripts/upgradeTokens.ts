import { ethers, upgrades } from "hardhat";
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});

async function main() {
  console.log("Upgrading contracts...");

  // Existing proxy addresses
  const EGOLD_PROXY = process.env.POLYGON_EGOLD_ADDRESS!;
  const ESLVR_PROXY = process.env.POLYGON_ESLVR_ADDRESS!;
  const INRX_PROXY  = process.env.POLYGON_INRX_ADDRESS!;

  // Upgrade EGold
  const EGold = await ethers.getContractFactory("EGold");
  const egold = await upgrades.upgradeProxy(EGOLD_PROXY, EGold);
  await egold.waitForDeployment();

  console.log("✅ EGold upgraded");
  console.log("Proxy Address:", await egold.getAddress());
  console.log(
    "Implementation:",
    await upgrades.erc1967.getImplementationAddress(await egold.getAddress())
  );

  const INRX = await ethers.getContractFactory("INRX");
  const inrx = await upgrades.upgradeProxy(INRX_PROXY, INRX);
  await inrx.waitForDeployment();

  console.log("✅ INRX upgraded");
  console.log("Proxy Address:", await inrx.getAddress());
  console.log(
    "Implementation:",
    await upgrades.erc1967.getImplementationAddress(await inrx.getAddress())
  );

  // Upgrade ESilver
  const ESilver = await ethers.getContractFactory("ESilver");
  const esilver = await upgrades.upgradeProxy(ESLVR_PROXY, ESilver);
  await esilver.waitForDeployment();

  console.log("✅ ESilver upgraded");
  console.log("Proxy Address:", await esilver.getAddress());
  console.log(
    "Implementation:",
    await upgrades.erc1967.getImplementationAddress(await esilver.getAddress())
  );

  console.log("🎉 Upgrade completed successfully");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});