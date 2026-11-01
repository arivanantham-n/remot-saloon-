const crypto = require('crypto');
const { encrypt, decrypt } = require('./encryption.service');

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateRandomBase32(length = 32) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += BASE32_CHARS[bytes[i] % 32];
  }
  return result;
}

function base32Decode(base32) {
  const cleaned = base32.replace(/=+$/, '').toUpperCase();
  let bits = '';
  for (let i = 0; i < cleaned.length; i++) {
    const val = BASE32_CHARS.indexOf(cleaned[i]);
    if (val === -1) throw new Error('Invalid base32 character');
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Validates TOTP code against secret with ±1 time step tolerance (RFC 6238)
 */
function verifyTOTP(token, secretBase32) {
  if (!token || !secretBase32) return false;
  const cleanToken = String(token).trim();

  const epoch = Math.floor(Date.now() / 1000);
  const currentStep = Math.floor(epoch / 30);

  // Check current, -30s, and +30s windows
  for (let stepOffset = -1; stepOffset <= 1; stepOffset++) {
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigInt64BE(BigInt(currentStep + stepOffset));

    const secretBuffer = base32Decode(secretBase32);
    const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24 |
                  (hmac[offset + 1] & 0xff) << 16 |
                  (hmac[offset + 2] & 0xff) << 8 |
                  (hmac[offset + 3] & 0xff)) % 1000000;

    if (String(code).padStart(6, '0') === cleanToken) {
      return true;
    }
  }
  return false;
}

/**
 * Generates setup payload for Authenticator Apps
 */
function setupMFA(userLabel = 'Admin') {
  const secret = generateRandomBase32(32);
  const issuer = encodeURIComponent('GloSalon');
  const account = encodeURIComponent(userLabel);
  const otpAuthUrl = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

  const backupCodes = [];
  const hashedBackupCodes = [];
  for (let i = 0; i < 8; i++) {
    const rawCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
    backupCodes.push(formatted);
    hashedBackupCodes.push(crypto.createHash('sha256').update(formatted).digest('hex'));
  }

  return {
    secret,
    encryptedSecret: encrypt(secret),
    otpAuthUrl,
    backupCodes,
    hashedBackupCodes
  };
}

module.exports = {
  setupMFA,
  verifyTOTP,
  decryptSecret: decrypt
};
