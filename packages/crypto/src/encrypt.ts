import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SCRYPT_N  = 16384;  // CPU cost — higher = slower = more secure
const SCRYPT_R  = 8;
const SCRYPT_P  = 1;

/**
 * Encrypt a mnemonic / private key using a password.
 * In production the "password" is a KMS-derived key, not a user password.
 *
 * Returns a single string: salt:iv:authTag:ciphertext (all hex)
 * This string is safe to store in the database.
 */
export function encrypt(plaintext: string, password: string): string {
  const salt = randomBytes(32);
  const iv   = randomBytes(12);  // 96-bit IV for GCM

  // Derive a 256-bit key from the password using scrypt
  const key = scryptSync(password, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag(); // GCM authentication tag

  return [
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

/**
 * Decrypt a previously encrypted string.
 * Will throw if password is wrong or data is tampered (authTag mismatch).
 */
export function decrypt(ciphertext: string, password: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4) throw new Error('Invalid ciphertext format');

  const [saltHex, ivHex, tagHex, encHex] = parts;
  const salt      = Buffer.from(saltHex, 'hex');
  const iv        = Buffer.from(ivHex,   'hex');
  const authTag   = Buffer.from(tagHex,  'hex');
  const encrypted = Buffer.from(encHex,  'hex');

  const key = scryptSync(password, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return (
    decipher.update(encrypted).toString('utf8') +
    decipher.final('utf8')
  );
}