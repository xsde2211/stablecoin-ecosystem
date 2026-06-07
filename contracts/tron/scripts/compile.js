const fs = require("fs");
const path = require("path");
const solc = require("solc");

const contractsDir = path.join(__dirname, "../contracts");
const buildDir = path.join(__dirname, "../build/contracts");

if (!fs.existsSync(buildDir))
    fs.mkdirSync(buildDir, { recursive: true });

function findImports(importPath) {
    try {
        if (importPath.startsWith("@")) {
            const p = path.join(__dirname, "../node_modules", importPath);
            return { contents: fs.readFileSync(p, "utf8") };
        }

        const p = path.join(contractsDir, importPath);
        return { contents: fs.readFileSync(p, "utf8") };
    } catch (e) {
        return { error: "File not found" };
    }
}

const input = {
    language: "Solidity",
    sources: {},
    settings: {
        optimizer: {
            enabled: true,
            runs: 200
        },
        outputSelection: {
            "*": {
                "*": ["abi", "evm.bytecode"]
            }
        }
    }
};

for (const file of fs.readdirSync(contractsDir)) {
    if (file.endsWith(".sol")) {
        input.sources[file] = {
            content: fs.readFileSync(
                path.join(contractsDir, file),
                "utf8"
            )
        };
    }
}

const output = JSON.parse(
    solc.compile(
        JSON.stringify(input),
        { import: findImports }
    )
);

for (const file in output.contracts) {
    for (const name in output.contracts[file]) {

        const contract = output.contracts[file][name];

        fs.writeFileSync(
            path.join(buildDir, `${name}.json`),
            JSON.stringify({
                abi: contract.abi,
                bytecode:
                    "0x" +
                    contract.evm.bytecode.object
            }, null, 2)
        );

        console.log(`✓ ${name}`);
    }
}