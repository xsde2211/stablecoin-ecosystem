"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMnemonic = generateMnemonic;
exports.validateMnemonic = validateMnemonic;
exports.mnemonicToSeed = mnemonicToSeed;
const bip39 = __importStar(require("bip39"));
// Generate a brand new 24-word seed phrase
// 256 bits of entropy = 24 words = most secure option
function generateMnemonic() {
    return bip39.generateMnemonic(256);
}
// Check if a seed phrase is valid English BIP39 words
function validateMnemonic(phrase) {
    return bip39.validateMnemonic(phrase.trim().toLowerCase());
}
// Convert mnemonic to raw seed bytes
// Used internally by derive.ts
function mnemonicToSeed(phrase) {
    return bip39.mnemonicToSeedSync(phrase.trim().toLowerCase());
}
//# sourceMappingURL=mnemonic.js.map