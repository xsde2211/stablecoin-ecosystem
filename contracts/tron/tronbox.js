module.exports = {
  networks: {
    // Local development (TronBox default)
    development: {
      privateKey: process.env.DEPLOYER_TRON_PRIVATE_KEY,
      userFeePercentage: 100,
      feeLimit: 1_000_000_000,
      fullHost: 'http://127.0.0.1:9090',
      network_id: '*',
    },

    // TRON Shasta testnet
    shasta: {
      privateKey:        process.env.DEPLOYER_TRON_PRIVATE_KEY,
      userFeePercentage: 100,
      feeLimit:          1_000_000_000,
      fullHost:          'https://api.shasta.trongrid.io',
      network_id:        '*',
    },

    // TRON Nile testnet (alternative)
    nile: {
      privateKey:        process.env.DEPLOYER_TRON_PRIVATE_KEY,
      userFeePercentage: 100,
      feeLimit:          1_000_000_000,
      fullHost:          'https://nile.trongrid.io',
      network_id:        '*',
    },

    // TRON Mainnet
    mainnet: {
      privateKey:        process.env.DEPLOYER_TRON_PRIVATE_KEY,
      userFeePercentage: 100,
      feeLimit:          1_000_000_000,
      fullHost:          'https://api.trongrid.io',
      network_id:        '*',
    },
  },

  compilers: {
    solc: {
      version: '0.8.20',
      settings: {
        optimizer: {
          enabled: true,
          runs:    200,
        },
      },
    },
  },

  // Tell TronBox where to find contracts
  // Points at both tron/contracts AND evm/contracts
  // so INRX.sol, EGold.sol, ESilver.sol compile for TRON too
  contracts_directory:  './contracts',
  contracts_build_directory: './build/contracts',
};