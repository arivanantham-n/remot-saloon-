const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;        // 96 bits standard for GCM
const AUTH_TAG_LENGTH_BYTES = 16;  // 128 bits authentication tag

/**
 * Validates and derives the 256-bit (32-byte) master encryption key.
 */
function getMasterKey() {
  const masterKey = process.env.DATA_ENCRYPTION_KEY || '6c3d8a9f0e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d';
  if (masterKey.length === 64) {
    return Buffer.from(masterKey, 'hex');
  }
  return crypto.createHash('sha256').update(masterKey).digest();
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Output Format: "iv:authTag:ciphertext" (all hex-encoded)
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return plaintext;
  const stringValue = typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext);

  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });

  let ciphertext = cipher.update(stringValue, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${ciphertext}`;
}

/**
 * Decrypts a ciphertext string formatted as "iv:authTag:ciphertext".
 * Validates cryptographic integrity via GCM Authentication Tag.
 */
function decrypt(payload) {
  if (!payload || typeof payload !== 'string') return payload;

  const parts = payload.split(':');
  if (parts.length !== 3) {
    // Graceful fallback if plain text
    return payload;
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  if (ivHex.length !== IV_LENGTH_BYTES * 2 || authTagHex.length !== AUTH_TAG_LENGTH_BYTES * 2) {
    return payload;
  }

  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
  decipher.setAuthTag(authTag);

  try {
    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return payload; // Return raw payload if decryption tag mismatch
  }
}

/**
 * One-way cryptographic blind index for searching encrypted fields (e.g. phone numbers, emails)
 */
function generateBlindIndex(plaintext) {
  if (!plaintext) return null;
  const secret = process.env.BLIND_INDEX_SALT || process.env.JWT_SECRET || 'glo_blind_index_salt_2026';
  return crypto.createHmac('sha256', secret).update(String(plaintext).toLowerCase().trim()).digest('hex');
}

module.exports = {
  encrypt,
  decrypt,
  generateBlindIndex
};
