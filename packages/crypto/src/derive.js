"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveAllAddresses = deriveAllAddresses;
exports.derivePrivateKey = derivePrivateKey;
exports.deriveSolanaKeypair = deriveSolanaKeypair;
const ethers_1 = require("ethers");
const tronweb_1 = require("tronweb");
const web3_js_1 = require("@solana/web3.js");
const mnemonic_1 = require("./mnemonic");
/**
 * From ONE mnemonic, derive addresses for all 5 chains.
 * This is how Trust Wallet / MetaMask work internally.
 *
 * Derivation paths used:
 *   EVM chains  →  m/44'/60'/0'/0/0  (standard Ethereum path)
 *   TRON        →  same path, different address encoding
 *   Solana      →  first 32 bytes of seed (simplified)
 */
function deriveAllAddresses(mnemonic) {
    // EVM: uses ethers HDNodeWallet
    const hdNode = ethers_1.ethers.HDNodeWallet.fromPhrase(mnemonic);
    const evmAddress = hdNode.address;
    // TRON: same private key, different Base58 encoding
    const tronPrivKey = hdNode.privateKey.slice(2); // remove 0x prefix
    const tronAddress = tronweb_1.TronWeb.address.fromPrivateKey(tronPrivKey);
    // Solana: derive from seed bytes
    const seed = (0, mnemonic_1.mnemonicToSeed)(mnemonic);
    const solanaKeypair = web3_js_1.Keypair.fromSeed(seed.slice(0, 32));
    return {
        ethereum: evmAddress,
        bsc: evmAddress, // same address on all EVM chains
        polygon: evmAddress, // same address on all EVM chains
        tron: tronAddress,
        solana: solanaKeypair.publicKey.toBase58(),
    };
}
// Get just the private key for a specific chain
function derivePrivateKey(mnemonic, chain) {
    const hdNode = ethers_1.ethers.HDNodeWallet.fromPhrase(mnemonic);
    return hdNode.privateKey; // 0x prefixed hex
}
// Get Solana keypair from mnemonic
function deriveSolanaKeypair(mnemonic) {
    const seed = (0, mnemonic_1.mnemonicToSeed)(mnemonic);
    return web3_js_1.Keypair.fromSeed(seed.slice(0, 32));
}
//# sourceMappingURL=derive.js.map