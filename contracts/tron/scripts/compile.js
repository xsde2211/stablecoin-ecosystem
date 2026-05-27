const path = require("path");
const fs = require("fs-extra");
const solc = require("solc");

const contractsDir = path.join(__dirname, "../contracts");
const buildDir = path.join(__dirname, "../build/contracts");

fs.ensureDirSync(buildDir);

const contractFiles = fs.readdirSync(contractsDir);

for (const file of contractFiles) {
  if (!file.endsWith(".sol")) continue;

  const filePath = path.join(contractsDir, file);
  const source = fs.readFileSync(filePath, "utf8");

  const input = {
    language: "Solidity",
    sources: {
      [file]: {
        content: source,
      },
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    for (const error of output.errors) {
      console.log(error.formattedMessage);
    }
  }

  const contracts = output.contracts[file];

  for (const contractName in contracts) {
    const artifact = contracts[contractName];

    fs.writeJsonSync(
      path.join(buildDir, `${contractName}.json`),
      {
        abi: artifact.abi,
        bytecode: artifact.evm.bytecode.object,
      },
      { spaces: 2 }
    );

    console.log(`Compiled: ${contractName}`);
  }
}