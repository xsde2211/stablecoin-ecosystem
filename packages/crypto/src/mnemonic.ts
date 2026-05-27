import * as bip39 from 'bip39';

// Generate a brand new 24-word seed phrase
// 256 bits of entropy = 24 words = most secure option
export function generateMnemonic(): string {
  return bip39.generateMnemonic(256);
}

// Check if a seed phrase is valid English BIP39 words
export function validateMnemonic(phrase: string): boolean {
  return bip39.validateMnemonic(phrase.trim().toLowerCase());
}

// Convert mnemonic to raw seed bytes
// Used internally by derive.ts
export function mnemonicToSeed(phrase: string): Buffer {
  return bip39.mnemonicToSeedSync(phrase.trim().toLowerCase());
}