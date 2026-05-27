const { TronWeb } = require('tronweb');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

// ─── Setup ────────────────────────────────────────────────────────────────────

const tronWeb = new TronWeb({
  fullHost:   process.env.TRON_RPC || 'https://api.shasta.trongrid.io',
  privateKey: process.env.DEPLOYER_TRON_PRIVATE_KEY,
});

// Helper: load compiled ABI + bytecode from tronbox build output
function loadContract(name) {
  const buildPath = path.join(__dirname, '../build/contracts', `${name}.json`);
  if (!fs.existsSync(buildPath)) {
    throw new Error(
      `Build file not found: ${buildPath}\n` +
      `Run 'tronbox compile' first.`
    );
  }
  const artifact = JSON.parse(fs.readFileSync(buildPath, 'utf8'));
  return {
    abi:      artifact.abi,
    bytecode: artifact.bytecode,
  };
}

// Helper: deploy one contract and return its address
async function deployContract(name, parameters = []) {
  console.log(`\nDeploying ${name}...`);
  const { abi, bytecode } = loadContract(name);

  const contract = await tronWeb.contract().new({
    abi,
    bytecode,
    feeLimit:   1_000_000_000,   // 1000 TRX max fee
    callValue:  0,
    parameters,
  });

  const address = contract.address;
  console.log(`✓ ${name} deployed at: ${address}`);
  return { contract, address, abi };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const deployer = tronWeb.defaultAddress.base58;
  console.log('=== TRON Deployment ===');
  console.log('Network:  ', process.env.TRON_RPC);
  console.log('Deployer: ', deployer);
  console.log('');

  // ── Constructor arguments ──────────────────────────────────────

  const INRX_MINT_CAP      = 1_000_000_000 * 1_000_000;   // 1B INRX  (6 decimals)
  const EGOLD_MINT_CAP     =     1_000_000 * 1_000_000;   // 1M grams (6 decimals)
  const ESLVR_MINT_CAP     = 1_000_000_000 * 1_000_000;   // 1B grams (6 decimals)
  const GOLD_INITIAL_PRICE =     5_900_000_000;            // ₹5,900/g (6 decimals)
  const SLVR_INITIAL_PRICE =        75_000_000;            // ₹75/g    (6 decimals)
  const REQUIRED_VALIDATORS = 2;

  // ── Deploy tokens ──────────────────────────────────────────────

  const { address: inrxAddress } = await deployContract(
    'INRX_TRC20',
    [INRX_MINT_CAP]
  );

  const { address: egoldAddress } = await deployContract(
    'EGold_TRC20',
    [EGOLD_MINT_CAP, GOLD_INITIAL_PRICE]
  );

  const { address: eslvrAddress } = await deployContract(
    'ESilver_TRC20',
    [ESLVR_MINT_CAP, SLVR_INITIAL_PRICE]
  );

  // ── Deploy bridge ──────────────────────────────────────────────

  const { address: bridgeAddress, contract: bridgeContract } = await deployContract(
    'TronBridge',
    [REQUIRED_VALIDATORS]
  );

  // ── Post-deploy configuration ──────────────────────────────────

  console.log('\n=== Configuring contracts ===');

  // Register all tokens in bridge
  console.log('Registering INRX in bridge...');
  await bridgeContract.registerToken('INRX', inrxAddress).send({
    feeLimit: 100_000_000,
  });

  console.log('Registering EGOLD in bridge...');
  await bridgeContract.registerToken('EGOLD', egoldAddress).send({
    feeLimit: 100_000_000,
  });

  console.log('Registering ESLVR in bridge...');
  await bridgeContract.registerToken('ESLVR', eslvrAddress).send({
    feeLimit: 100_000_000,
  });

  // Add validators if provided in env
  const validatorAddresses = (process.env.TRON_VALIDATORS || '').split(',').filter(Boolean);
  for (const v of validatorAddresses) {
    console.log(`Adding validator: ${v}`);
    await bridgeContract.addValidator(v).send({ feeLimit: 100_000_000 });
  }

  // Set bridge as minter on each token
  // (so bridge can mint unlocked tokens coming from other chains)
  const inrxContract  = await tronWeb.contract().at(inrxAddress);
  const egoldContract = await tronWeb.contract().at(egoldAddress);
  const eslvrContract = await tronWeb.contract().at(eslvrAddress);

  console.log('Setting bridge as minter for INRX...');
  await inrxContract.setMinter(bridgeAddress).send({ feeLimit: 100_000_000 });

  console.log('Setting bridge as minter for EGOLD...');
  await egoldContract.setMinter(bridgeAddress).send({ feeLimit: 100_000_000 });

  console.log('Setting bridge as minter for ESLVR...');
  await eslvrContract.setMinter(bridgeAddress).send({ feeLimit: 100_000_000 });

  // ── Save deployment output ─────────────────────────────────────

  const deploymentOutput = {
    network:     process.env.TRON_RPC,
    deployedBy:  deployer,
    deployedAt:  new Date().toISOString(),
    contracts: {
      INRX:       inrxAddress,
      EGOLD:      egoldAddress,
      ESLVR:      eslvrAddress,
      TronBridge: bridgeAddress,
    },
  };

  const outDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(
    path.join(outDir, 'tron.json'),
    JSON.stringify(deploymentOutput, null, 2)
  );

  console.log('\n=== Deployment Complete ===');
  console.log(JSON.stringify(deploymentOutput, null, 2));
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});