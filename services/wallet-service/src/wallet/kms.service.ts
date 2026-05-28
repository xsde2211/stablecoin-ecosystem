import { Injectable, Logger } from '@nestjs/common';
import {
  encrypt as aesEncrypt,
  decrypt as aesDecrypt,
} from '@ecosystem/crypto';

/**
 * KMS Service — wraps encryption of private keys.
 *
 * In development: uses a master key from environment variable.
 * In production:  replace encrypt/decrypt with AWS KMS calls.
 *   The master key never lives in code — it stays in AWS KMS.
 */
@Injectable()
export class KmsService {
  private readonly logger = new Logger(KmsService.name);
  private readonly masterKey: string;

  constructor() {
    const key = process.env.ENCRYPTION_MASTER_KEY;
    if (!key || key.length < 32) {
      throw new Error(
        'ENCRYPTION_MASTER_KEY must be set and at least 32 characters'
      );
    }
    this.masterKey = key;
  }

  async encrypt(plaintext: string): Promise<string> {
    return aesEncrypt(plaintext, this.masterKey);
  }

  async decrypt(ciphertext: string): Promise<string> {
    return aesDecrypt(ciphertext, this.masterKey);
  }
}