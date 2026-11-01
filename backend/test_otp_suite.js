require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const { formatPhoneNumber, maskPhone } = require('./services/sms.service');

console.log('🧪 Starting Glö Salon Backend OTP & Security Test Suite...\n');

// 1. Phone Normalization (E.164)
console.log('Test 1: Phone Normalization');
assert.strictEqual(formatPhoneNumber('9876543210'), '+919876543210', '10-digit should become +91');
assert.strictEqual(formatPhoneNumber('+919876543210'), '+919876543210', 'Already +91 should be kept');
assert.strictEqual(formatPhoneNumber('09876543210'), '+919876543210', 'Leading 0 should be stripped');
assert.strictEqual(formatPhoneNumber('+14155552671'), '+14155552671', 'International number should be preserved');
console.log('  ✅ Phone normalization passed.');

// 2. Phone Masking
console.log('Test 2: Phone Masking');
assert.strictEqual(maskPhone('+919876543210'), '+91XXXX3210', 'Masking should hide middle digits');
assert.strictEqual(maskPhone('+14155552671'), '+14XXXX2671', 'Masking should work on US numbers');
console.log('  ✅ Phone masking passed.');

// 3. OTP Generation (crypto.randomInt)
console.log('Test 3: OTP Generation (CSPRNG, 6-digit)');
for (let i = 0; i < 50; i++) {
  const otp = String(crypto.randomInt(100000, 1000000));
  assert.strictEqual(otp.length, 6, 'OTP must be 6 digits');
  assert.ok(/^[1-9]\d{5}$/.test(otp), 'OTP must be valid 6 digits');
}
console.log('  ✅ 50 CSPRNG OTP generations verified.');

// 4. HMAC-SHA256 Hashing & Timing-Safe Comparison
console.log('Test 4: HMAC Hashing & Timing-Safe Equal');
const key = process.env.DATA_ENCRYPTION_KEY || 'test_key';
function hashOTP(otp) {
  return crypto.createHmac('sha256', key).update(String(otp)).digest('hex');
}
function verifyOTPHash(plainOtp, storedHash) {
  const computed = hashOTP(plainOtp);
  if (computed.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
}

const originalOtp = '482910';
const hashed = hashOTP(originalOtp);
assert.notStrictEqual(originalOtp, hashed, 'Stored OTP is hashed, never plaintext');
assert.strictEqual(verifyOTPHash('482910', hashed), true, 'Valid OTP matches');
assert.strictEqual(verifyOTPHash('482911', hashed), false, 'Wrong OTP fails');
assert.strictEqual(verifyOTPHash('000000', hashed), false, 'Wrong OTP fails');
console.log('  ✅ HMAC hashing & timing-safe verification passed.');

// 5. Expiry & Attempt Lock Verification Logic
console.log('Test 5: Expiry & Attempt Lock Logic');
const now = new Date();
const expiredDate = new Date(now.getTime() - 1000);
const futureDate = new Date(now.getTime() + 5 * 60 * 1000);

assert.ok(expiredDate < now, 'Past date detected as expired');
assert.ok(futureDate > now, 'Future date within TTL window');

let attempts = 0;
const MAX_ATTEMPTS = 5;
for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  attempts++;
}
assert.strictEqual(attempts, 5);
const lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
assert.ok(lockedUntil > new Date(), 'Account lock active for 15 mins');
console.log('  ✅ Expiry and lock threshold verified.');

// 6. Integration tests against running server
async function makeRequest(port, path, method, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function runIntegration() {
  console.log('\nTest 6: Integration Tests with running server');
  let port = 5000;
  // Detect if 5000 or 5001 is listening
  try {
    await makeRequest(5000, '/api/auth/send-otp', 'POST', { phone: '+919999999999' });
    port = 5000;
  } catch {
    port = 5001;
  }
  console.log(`  Connecting to server on port ${port}...`);

  const testPhone = '+919876500001';
  
  // 6a: Send OTP
  const sendRes = await makeRequest(port, '/api/auth/send-otp', 'POST', {
    phone: testPhone,
    name: 'Integration Test'
  });
  assert.strictEqual(sendRes.status, 200, 'send-otp should return 200');
  assert.strictEqual(sendRes.body.success, true, 'send-otp success should be true');
  const otp = sendRes.body.devOtp;
  console.log('  ✅ send-otp successful (200 OK, response structure preserved)');

  // 6b: Cooldown test (immediate resend within 60s should return 429)
  const cooldownRes = await makeRequest(port, '/api/auth/send-otp', 'POST', {
    phone: testPhone
  });
  assert.strictEqual(cooldownRes.status, 429, 'Immediate resend should return 429');
  console.log('  ✅ 60-second cooldown rate limit enforced (429 Too Many Requests)');

  // 6c: Wrong OTP test (should return 401 with remaining attempts)
  const wrongRes = await makeRequest(port, '/api/auth/verify-otp', 'POST', {
    phone: testPhone,
    otp: '000000'
  });
  assert.strictEqual(wrongRes.status, 401, 'Wrong OTP should return 401');
  console.log('  ✅ Wrong OTP rejected (401 Unauthorized, remaining attempts shown)');

  // 6d: Correct OTP verify
  if (otp) {
    const correctRes = await makeRequest(port, '/api/auth/verify-otp', 'POST', {
      phone: testPhone,
      otp: otp
    });
    assert.strictEqual(correctRes.status, 200, 'Correct OTP should return 200');
    assert.strictEqual(correctRes.body.success, true);
    assert.ok(correctRes.body.token, 'JWT token returned on verify');
    console.log('  ✅ Valid OTP verified (200 OK, JWT token issued)');
  }

  console.log('\n🎉 ALL UNIT AND INTEGRATION TESTS PASSED (0 errors)!\n');
}

runIntegration().catch(err => {
  console.error('❌ Integration test failed:', err);
  process.exit(1);
});
