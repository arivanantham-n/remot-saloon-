require('dotenv').config();
const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');

console.log('🧪 Starting Glö Salon Role-Based Profile & RBAC Security Test Suite...\n');

const PORT = 5000;

function makeRequest(path, method, data, token) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers
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
    if (payload) req.write(payload);
    req.end();
  });
}

async function loginAndGetToken(phone, name) {
  const sendRes = await makeRequest('/api/auth/send-otp', 'POST', { phone, name });
  assert.strictEqual(sendRes.status, 200, `send-otp for ${phone} should succeed`);
  const otp = sendRes.body.devOtp;
  assert.ok(otp, 'devOtp should be present in development environment');

  const verifyRes = await makeRequest('/api/auth/verify-otp', 'POST', { phone, otp });
  assert.strictEqual(verifyRes.status, 200, `verify-otp for ${phone} should succeed`);
  assert.ok(verifyRes.body.token, 'token should be issued');
  return { token: verifyRes.body.token, user: verifyRes.body.user };
}

async function runTests() {
  console.log('1. Authenticating test users via server OTP flow...');
  
  // 1a: Client login (regular client phone)
  const clientAuth = await loginAndGetToken('+919876599999', 'Ananya Client');
  const clientToken = clientAuth.token;
  assert.strictEqual(clientAuth.user.role, 'client', 'User without salon should have role client');
  console.log('  ✅ Client authenticated: role=client');

  // 1b: Salon Owner login (using seeded salon phone +919876543210)
  const ownerAuth = await loginAndGetToken('+919876543210', 'Priya Sharma');
  const ownerToken = ownerAuth.token;
  assert.strictEqual(ownerAuth.user.role, 'salon_owner', 'User with registered salon phone should be auto-detected as salon_owner');
  console.log('  ✅ Salon Owner authenticated: role=salon_owner');

  const JWT_SECRET = process.env.JWT_SECRET || 'glo_secret';
  const expiredToken = jwt.sign({ id: clientAuth.user.id, role: 'client' }, JWT_SECRET, { expiresIn: '-1s' });
  const tamperedToken = clientToken.slice(0, -6) + 'xxxxxx';

  // ─── 2. Client Profile RBAC & Tests ─────────────────────────────────────────
  console.log('\n2. Testing Client Profile RBAC:');

  // 2a: Client can read own profile
  const cGet = await makeRequest('/api/profile/client', 'GET', null, clientToken);
  assert.strictEqual(cGet.status, 200, 'Client GET /profile/client should be 200');
  assert.strictEqual(cGet.body.profile.role, 'client');
  assert.strictEqual(cGet.body.profile.name, 'Ananya Client');
  console.log('  ✅ Client can read GET /profile/client (200 OK)');

  // 2b: Client can update own profile
  const cPatch = await makeRequest('/api/profile/client', 'PATCH', { name: 'Ananya S.' }, clientToken);
  assert.strictEqual(cPatch.status, 200, 'Client PATCH /profile/client should be 200');
  assert.strictEqual(cPatch.body.profile.name, 'Ananya S.');
  console.log('  ✅ Client can update PATCH /profile/client (200 OK)');

  // 2c: Salon Owner CANNOT read Client profile (403 Forbidden)
  const oBlockedFromClientGet = await makeRequest('/api/profile/client', 'GET', null, ownerToken);
  assert.strictEqual(oBlockedFromClientGet.status, 403, 'Salon owner GET /profile/client must be 403');
  console.log('  ✅ Salon Owner access to GET /profile/client BLOCKED (403 Forbidden)');

  // 2d: Salon Owner CANNOT patch Client profile (403 Forbidden)
  const oBlockedFromClientPatch = await makeRequest('/api/profile/client', 'PATCH', { name: 'Compromised' }, ownerToken);
  assert.strictEqual(oBlockedFromClientPatch.status, 403, 'Salon owner PATCH /profile/client must be 403');
  console.log('  ✅ Salon Owner update to PATCH /profile/client BLOCKED (403 Forbidden)');

  // ─── 3. Salon Owner Profile RBAC & Tests ─────────────────────────────────────
  console.log('\n3. Testing Salon Owner Profile RBAC:');

  // 3a: Salon Owner can read own profile
  const oGet = await makeRequest('/api/profile/owner', 'GET', null, ownerToken);
  assert.strictEqual(oGet.status, 200, 'Owner GET /profile/owner should be 200');
  assert.strictEqual(oGet.body.hasSalon, true);
  assert.strictEqual(oGet.body.profile.salonName, 'Luxe Studio & Spa');
  assert.strictEqual(oGet.body.profile.phoneVerified, true);
  assert.ok(oGet.body.profile.payoutDetails, 'Payout details object returned');
  console.log('  ✅ Salon Owner can read GET /profile/owner (200 OK, verified badge)');

  // 3b: Salon Owner can update own profile (and add payout details)
  const oPatch = await makeRequest('/api/profile/owner', 'PATCH', {
    bio: 'Award-winning luxury spa and salon experience.',
    payoutDetails: {
      accountHolderName: 'Priya Sharma',
      accountNumber: '123456789012',
      ifscCode: 'HDFC0001234',
      upiId: 'priyasharma@okhdfcbank'
    }
  }, ownerToken);
  assert.strictEqual(oPatch.status, 200, 'Owner PATCH /profile/owner should be 200');
  assert.strictEqual(oPatch.body.profile.bio, 'Award-winning luxury spa and salon experience.');
  // Confirm financial masking
  const payout = oPatch.body.profile.payoutDetails;
  assert.strictEqual(payout.accountNumber, 'XXXXXX9012', 'Account number must be masked on return (last 4 digits only)');
  assert.strictEqual(payout.upiId, 'pr***@okhdfcbank', 'UPI ID must be masked on return');
  console.log('  ✅ Salon Owner update PATCH /profile/owner succeeded & payouts MASKED (XXXXXX9012)');

  // 3c: Client CANNOT read Salon Owner profile (403 Forbidden)
  const cBlockedFromOwnerGet = await makeRequest('/api/profile/owner', 'GET', null, clientToken);
  assert.strictEqual(cBlockedFromOwnerGet.status, 403, 'Client GET /profile/owner must be 403');
  console.log('  ✅ Client access to GET /profile/owner BLOCKED (403 Forbidden)');

  // 3d: Client CANNOT patch Salon Owner profile (403 Forbidden)
  const cBlockedFromOwnerPatch = await makeRequest('/api/profile/owner', 'PATCH', { bio: 'Hacked' }, clientToken);
  assert.strictEqual(cBlockedFromOwnerPatch.status, 403, 'Client PATCH /profile/owner must be 403');
  console.log('  ✅ Client update to PATCH /profile/owner BLOCKED (403 Forbidden)');

  // ─── 4. Authentication Token Security ─────────────────────────────────────────
  console.log('\n4. Testing Token Authentication Security:');

  const unauth = await makeRequest('/api/profile/client', 'GET', null, null);
  assert.strictEqual(unauth.status, 401, 'No token must return 401');
  console.log('  ✅ Missing token rejected (401 Unauthorized)');

  const expired = await makeRequest('/api/profile/client', 'GET', null, expiredToken);
  assert.strictEqual(expired.status, 401, 'Expired token must return 401');
  console.log('  ✅ Expired token rejected (401 Unauthorized)');

  const tampered = await makeRequest('/api/profile/client', 'GET', null, tamperedToken);
  assert.strictEqual(tampered.status, 401, 'Tampered token must return 401');
  console.log('  ✅ Tampered token rejected (401 Unauthorized)');

  // ─── 5. Mass-Assignment & Input Validation Protection ────────────────────────
  console.log('\n5. Testing Mass-Assignment & Validation:');

  // Mass assignment: client attempts to change role to admin
  await makeRequest('/api/profile/client', 'PATCH', { role: 'admin' }, clientToken);
  const verifyClientRole = await makeRequest('/api/profile/client', 'GET', null, clientToken);
  assert.strictEqual(verifyClientRole.body.profile.role, 'client', 'Role cannot be changed via profile PATCH');
  console.log('  ✅ Client role elevation prevented (role remained client)');

  // Mass assignment: owner attempts to change verification status
  await makeRequest('/api/profile/owner', 'PATCH', { verificationStatus: 'rejected', status: 'rejected' }, ownerToken);
  const verifyOwnerStatus = await makeRequest('/api/profile/owner', 'GET', null, ownerToken);
  assert.strictEqual(verifyOwnerStatus.body.profile.verificationStatus, 'approved', 'Verification status cannot be changed via profile PATCH');
  console.log('  ✅ Salon verification status alteration prevented (status remained approved)');

  // Validation: invalid email format
  const invalidEmail = await makeRequest('/api/profile/client', 'PATCH', { email: 'invalid-email-address' }, clientToken);
  assert.strictEqual(invalidEmail.status, 400, 'Invalid email must return 400');
  console.log('  ✅ Invalid email format rejected (400 Bad Request)');

  // Validation: invalid pincode format
  const invalidPincode = await makeRequest('/api/profile/owner', 'PATCH', { pincode: '123' }, ownerToken);
  assert.strictEqual(invalidPincode.status, 400, 'Pincode not 6-digits must return 400');
  console.log('  ✅ Invalid pincode rejected (400 Bad Request)');

  console.log('\n🎉 ALL ROLE-BASED PROFILE & RBAC TESTS PASSED SUCCESSFULLY (0 errors)!\n');
}

runTests().catch(err => {
  console.error('❌ Test suite error:', err);
  process.exit(1);
});
