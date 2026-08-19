import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * 🔒 GX Encrypted Environment Vault
 * Powered by PBKDF2 (HMAC-SHA512 with 100,000 iterations) + AES-256-GCM authenticated encryption.
 */

const VAULT_SALT = 'gx_secure_env_salt_9e4c1a7b3d2f8e01';
const VAULT_ITERATIONS = 100000;
const VAULT_KEYLEN = 32; // 256-bit key for AES-256-GCM
const VAULT_DIGEST = 'sha512';
const MASTER_KEY_PHRASE = process.env.GX_VAULT_KEY || 'Qwert54321!@#$%';

/**
 * Derives a 256-bit encryption key using SHA-512 PBKDF2.
 */
function deriveKey(passphrase = MASTER_KEY_PHRASE) {
  return crypto.pbkdf2Sync(
    passphrase,
    VAULT_SALT,
    VAULT_ITERATIONS,
    VAULT_KEYLEN,
    VAULT_DIGEST
  );
}

/**
 * Encrypts a string (e.g. .env content) using AES-256-GCM.
 */
export function encryptEnvContent(plainText, passphrase = MASTER_KEY_PHRASE) {
  const key = deriveKey(passphrase);
  const iv = crypto.randomBytes(12); // GCM standard 96-bit IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return JSON.stringify({
    version: '1.0',
    cipher: 'aes-256-gcm',
    kdf: 'pbkdf2-sha512',
    iterations: VAULT_ITERATIONS,
    iv: iv.toString('hex'),
    authTag,
    ciphertext: encrypted
  }, null, 2);
}

/**
 * Decrypts an encrypted vault string.
 */
export function decryptEnvContent(encryptedJsonStr, passphrase = MASTER_KEY_PHRASE) {
  try {
    const payload = typeof encryptedJsonStr === 'string' ? JSON.parse(encryptedJsonStr) : encryptedJsonStr;
    const key = deriveKey(passphrase);
    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    throw new Error(`Failed to decrypt environment vault: ${err.message}`);
  }
}

/**
 * Automatically loads and injects encrypted .env.enc or plain .env into process.env in memory.
 */
export function syncEnvToEncrypted(envFilePath = '.env', encFilePath = '.env.enc') {
  const resolvedEnv = path.resolve(envFilePath);
  const resolvedEnc = path.resolve(encFilePath);
  if (!fs.existsSync(resolvedEnv)) {
    throw new Error(`Cannot find ${resolvedEnv} to encrypt.`);
  }
  const plain = fs.readFileSync(resolvedEnv, 'utf8');
  const encrypted = encryptEnvContent(plain);
  const encDir = path.dirname(resolvedEnc);
  if (!fs.existsSync(encDir)) fs.mkdirSync(encDir, { recursive: true });
  fs.writeFileSync(resolvedEnc, encrypted, 'utf8');
  console.log(`✅ [GX Vault] تم تشفير ${envFilePath} وحفظه في ${encFilePath} بنجاح!`);
}

export function loadVaultEnvironment(envFilePath = '.env', encFilePath = '.env.enc') {
  const resolvedEnv = path.resolve(envFilePath);
  const resolvedEnc = path.resolve(encFilePath);

  // 1. If encrypted vault exists, decrypt and load into memory
  if (fs.existsSync(resolvedEnc)) {
    try {
      const rawEnc = fs.readFileSync(resolvedEnc, 'utf8');
      const decrypted = decryptEnvContent(rawEnc);
      parseAndInjectEnv(decrypted);
      console.log('🔒 [GX Vault] تم تحميل وفك تشفير متغيرات البيئة من .env.enc بنجاح (SHA-512 / AES-256-GCM)');
      return;
    } catch (err) {
      console.warn(`⚠️ [GX Vault] تعذر فك تشفير .env.enc: ${err.message}. جارٍ المحاولة من .env...`);
    }
  }

  // 2. Fallback to standard .env file if available
  if (fs.existsSync(resolvedEnv)) {
    const rawPlain = fs.readFileSync(resolvedEnv, 'utf8');
    parseAndInjectEnv(rawPlain);
    console.log('📄 [GX Vault] تم تحميل متغيرات البيئة من ملف .env المحلي.');
  }
}
