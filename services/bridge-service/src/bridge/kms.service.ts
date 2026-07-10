import { Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * KMS Service — AES-256-GCM encryption for stored mnemonics.
 *
 * IMPORTANT: this must use the EXACT SAME ENCRYPTION_MASTER_KEY as
 * wallet-service's KmsService — wallets are encrypted once, by
 * wallet-service, and this service only ever needs to decrypt them (to sign
 * the lock/burn transaction on the user's behalf). If the keys don't match,
 * every decrypt() call here will throw.
 *
 * In production: swap encrypt/decrypt with AWS KMS / Google Cloud KMS calls
 * (matching whatever wallet-service ends up using).
 */
@Injectable()
export class KmsService {
  private readonly logger    = new Logger(KmsService.name);
  private readonly masterKey: Buffer;

  constructor() {
    const raw = process.env.ENCRYPTION_MASTER_KEY;
    if (!raw || raw.length < 32) {
      throw new Error('ENCRYPTION_MASTER_KEY must be set and at least 32 characters (same value as wallet-service) in bridge-service\'s .env');
    }
    this.masterKey = scryptSync(raw, 'stablecoin-kms-salt-v1', 32);
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv        = randomBytes(16);
    const cipher    = createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag   = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  async decrypt(ciphertext: string): Promise<string> {
    const [ivHex, tagHex, dataHex] = ciphertext.split(':');
    if (!ivHex || !tagHex || !dataHex) throw new Error('Invalid encrypted format');
    const iv       = Buffer.from(ivHex,  'hex');
    const authTag  = Buffer.from(tagHex, 'hex');
    const data     = Buffer.from(dataHex,'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }
}