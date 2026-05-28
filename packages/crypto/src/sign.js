"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.signEVMTransaction = signEVMTransaction;
exports.sendEVMToken = sendEVMToken;
exports.sendTRONToken = sendTRONToken;
exports.signMessage = signMessage;
const ethers_1 = require("ethers");
const tronweb_1 = require("tronweb");
/**
 * Sign a raw EVM transaction (works for Ethereum, BSC, Polygon)
 * Returns the signed tx hex ready to broadcast
 */
async function signEVMTransaction(mnemonic, tx, rpcUrl) {
    const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
    const wallet = ethers_1.ethers.HDNodeWallet.fromPhrase(mnemonic).connect(provider);
    return wallet.signTransaction(tx);
}
/**
 * Sign and broadcast an EVM token transfer
 * Returns transaction hash
 */
async function sendEVMToken(mnemonic, rpcUrl, tokenAddress, toAddress, amount) {
    const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
    const wallet = ethers_1.ethers.HDNodeWallet.fromPhrase(mnemonic).connect(provider);
    const erc20 = new ethers_1.ethers.Contract(tokenAddress, ['function transfer(address to, uint256 amount) returns (bool)'], wallet);
    const tx = await erc20.transfer(toAddress, amount);
    const receipt = await tx.wait();
    return receipt.hash;
}
/**
 * Sign and broadcast a TRON TRC20 token transfer
 * Returns transaction ID
 */
async function sendTRONToken(mnemonic, tronRpc, tokenAddress, toAddress, amount) {
    const hdNode = ethers_1.ethers.HDNodeWallet.fromPhrase(mnemonic);
    const privKey = hdNode.privateKey.slice(2);
    const tronWeb = new tronweb_1.TronWeb({
        fullHost: tronRpc,
        privateKey: privKey,
    });
    const contract = await tronWeb.contract().at(tokenAddress);
    const txId = await contract.transfer(toAddress, amount).send({
        feeLimit: 100000000,
    });
    return txId;
}
/**
 * Sign a message with EVM wallet (used by bridge validators)
 */
async function signMessage(mnemonic, message) {
    const wallet = ethers_1.ethers.HDNodeWallet.fromPhrase(mnemonic);
    return wallet.signMessage(message);
}
//# sourceMappingURL=sign.js.map