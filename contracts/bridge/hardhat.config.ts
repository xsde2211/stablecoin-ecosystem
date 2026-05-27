import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    sepolia: {
      url: process.env.ETH_RPC!,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY!],
    },
    bscTestnet: {
      url: process.env.BSC_RPC!,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY!],
    },
    polygonAmoy: {
      url: process.env.POLYGON_RPC!,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY!],
    },
  },
  etherscan: {
    apiKey: {
      sepolia:      process.env.ETHERSCAN_KEY!,
      bscTestnet:   process.env.BSCSCAN_KEY!,
      polygonAmoy:  process.env.POLYGONSCAN_KEY!,
    },
  },
};

export default config;