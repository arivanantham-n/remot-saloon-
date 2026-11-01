const router = require('express').Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { generateBlindIndex } = require('../services/encryption.service');
const { setupMFA, verifyTOTP, decryptSecret } = require('../services/mfa.service');
const { sendSMS, formatPhoneNumber, maskPhone } = require('../services/sms.service');

// ─── Dual OTP Dispatch ─────────────────────────────────────────────────────────
// Sends the SAME OTP to the client's phone AND the salon owner's phone (if the
// requesting user owns a salon). Uses Promise.allSettled so one failure never
// blocks or breaks the other send. Owner's number is fetched server-side only.
async function sendOtpToBoth(clientPhone, otp, userId) {
  const Salon = require('../models/Salon');

  const clientMsg = `Your Glo Salon OTP is: ${otp}. Valid for 5 minutes. Do not share this code with anyone. - Glo Salon`;
  const ownerMsg  = `Glo Salon: A login OTP ${otp} was generated for your salon account. Valid 5 min. If this was not you, contact support immediately.`;

  // Always notify the client
  const targets = [
    { number: clientPhone, label: 'client', message: clientMsg }
  ];

  // Fetch the salon linked to this user and add the owner number if different
  try {
    const digitsOnly = String(clientPhone).replace(/\D/g, '').slice(-10);
    const flexPhoneRegex = new RegExp(digitsOnly.split('').join('[\\s-]*'));
    const salon = await Salon.findOne({
      $or: [
        { owner: userId },
        { phone: clientPhone },
        { phone: flexPhoneRegex }
      ]
    }).select('phone name').lean();

    if (salon && salon.phone) {
      const ownerE164   = formatPhoneNumber(salon.phone);
      const clientE164  = formatPhoneNumber(clientPhone);
      if (ownerE164 !== clientE164) {
        targets.push({ number: ownerE164, label: `owner(${salon.name})`, message: ownerMsg });
        console.log(`📋 OTP will also be sent to salon owner | salon=${salon.name} | to=${maskPhone(ownerE164)}`);
      }
    }
  } catch (lookupErr) {
    // Non-fatal: client OTP still goes out even if owner lookup fails
    console.warn(`⚠️  Salon owner lookup skipped during OTP dispatch: ${lookupErr.message}`);
  }

  // Fire all sends concurrently; log per-recipient success/failure
  const results = await Promise.allSettled(
    targets.map(t =>
      sendSMS(t.number, t.message).then(ok => ({ label: t.label, number: t.number, ok }))
    )
  );

  let anySucceeded = false;
  results.forEach(r => {
    if (r.status === 'fulfilled') {
      const { label, number, ok } = r.value;
      if (ok) {
        anySucceeded = true;
        console.log(`✅ OTP SMS delivered | recipient=${label} | to=${maskPhone(formatPhoneNumber(number))}`);
      } else {
        console.warn(`⚠️  OTP SMS failed    | recipient=${label} | to=${maskPhone(formatPhoneNumber(number))}`);
      }
    } else {
      console.error(`❌ OTP send error: ${r.reason?.message}`);
    }
  });

  return anySucceeded;
}

// ─── OTP Security Utilities ────────────────────────────────────────────────────

// Generate 6-digit cryptographically secure OTP
function generateSecureOTP() {
  return String(crypto.randomInt(100000, 1000000));
}

// HMAC-SHA256 hash for OTP storage (never store plaintext OTP)
function hashOTP(otp) {
  const key = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET || 'glo_secret';
  return crypto.createHmac('sha256', key).update(String(otp)).digest('hex');
}

// Timing-safe OTP comparison
function verifyOTPHash(plainOtp, storedHash) {
  const computed = hashOTP(plainOtp);
  if (computed.length !== storedHash.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────────
const RESEND_COOLDOWN_MS = 60 * 1000;       // 60 seconds between OTP requests
const MAX_VERIFY_ATTEMPTS = 5;               // Lock after 5 failed attempts
const LOCK_DURATION_MS = 15 * 60 * 1000;     // 15-minute lock

function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('glo_token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/'
  });
}

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  try {
    const { phone, name } = req.body;
    const phoneRegex = /^\+?[1-9]\d{6,14}$/;
    if (!phone || typeof phone !== 'string' || !phoneRegex.test(phone.trim())) {
      return res.status(400).json({ error: 'A valid phone number is required (e.g., +919876543210)' });
    }

    const cleanPhone = phone.trim();
    const phoneBlind = generateBlindIndex(cleanPhone);
    const maskedNum = maskPhone(formatPhoneNumber(cleanPhone));

    let user = await User.findOne({ 
      $or: [{ phoneBlindIndex: phoneBlind }, { phone: cleanPhone }] 
    }).select('+otp +otpExpiry +lastOtpSentAt');

    // Resend cooldown: 60 seconds between OTP requests per phone
    if (user && user.lastOtpSentAt) {
      const elapsed = Date.now() - new Date(user.lastOtpSentAt).getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const remaining = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({ error: `Please wait ${remaining} seconds before requesting a new OTP.` });
      }
    }

    const otp = generateSecureOTP();
    const hashedOtp = hashOTP(otp);
    const otpExpiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 5;
    const otpExpiry = new Date(Date.now() + otpExpiryMinutes * 60 * 1000);

    if (!user) {
      user = new User({ 
        phone: cleanPhone, 
        name: name || 'Guest', 
        otp: hashedOtp, 
        otpExpiry,
        lastOtpSentAt: new Date(),
        otpAttempts: 0,
        otpLockedUntil: undefined
      });
    } else {
      user.otp = hashedOtp;
      user.otpExpiry = otpExpiry;
      user.lastOtpSentAt = new Date();
      user.otpAttempts = 0;           // Reset attempts on new OTP
      user.otpLockedUntil = undefined; // Clear any lock
      if (name) user.name = name;
    }
    await user.save();

    console.log(`📱 OTP generated | phone=${maskedNum} | expires=${otpExpiryMinutes}min`);

    // Dispatch OTP via Twilio to client + salon owner (if applicable)
    const smsDispatched = await sendOtpToBoth(cleanPhone, otp, user._id);

    res.json({
      success: true,
      message: `OTP sent successfully to ${formatPhoneNumber(cleanPhone)}.`,
      devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined
    });
  } catch (err) {
    console.error('❌ OTP Generation Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP are required' });

    const cleanPhone = String(phone).trim();
    const phoneBlind = generateBlindIndex(cleanPhone);
    const maskedNum = maskPhone(formatPhoneNumber(cleanPhone));

    const user = await User.findOne({
      $or: [{ phoneBlindIndex: phoneBlind }, { phone: cleanPhone }]
    }).select('+otp +otpExpiry +mfaEnabled +otpAttempts +otpLockedUntil');

    if (!user) return res.status(404).json({ error: 'User not found. Please request an OTP first.' });

    // Check if account is locked from too many failed attempts
    if (user.otpLockedUntil && user.otpLockedUntil > new Date()) {
      const mins = Math.ceil((user.otpLockedUntil - new Date()) / 60000);
      console.warn(`🔒 OTP verify blocked (locked) | phone=${maskedNum} | unlocks_in=${mins}min`);
      return res.status(429).json({ error: `Too many failed attempts. Please try again in ${mins} minutes.` });
    }

    // Check expiry first
    if (!user.otp || user.otpExpiry < new Date()) {
      return res.status(401).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    // Timing-safe HMAC comparison
    const otpMatch = verifyOTPHash(String(otp).trim(), user.otp);

    if (!otpMatch) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      const remaining = MAX_VERIFY_ATTEMPTS - user.otpAttempts;

      if (user.otpAttempts >= MAX_VERIFY_ATTEMPTS) {
        user.otpLockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
        user.otp = undefined;
        user.otpExpiry = undefined;
        await user.save();
        console.warn(`🔒 Account locked (max attempts) | phone=${maskedNum}`);
        return res.status(429).json({ error: 'Too many failed attempts. Your account is locked for 15 minutes.' });
      }

      await user.save();
      console.warn(`⚠️  Invalid OTP attempt ${user.otpAttempts}/${MAX_VERIFY_ATTEMPTS} | phone=${maskedNum}`);
      return res.status(401).json({ error: `Invalid verification code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` });
    }

    // OTP is valid — clear it (single use)
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpiry = undefined;
    user.otpAttempts = 0;
    user.otpLockedUntil = undefined;
    await user.save();

    // Auto-detect salon ownership if phone matches registered salon
    const Salon = require('../models/Salon');
    const digitsOnly = cleanPhone.replace(/\D/g, '').slice(-10);
    const flexiblePhoneRegex = new RegExp(digitsOnly.split('').join('[\\s-]*'));
    const existingSalon = await Salon.findOne({
      $or: [
        { owner: user._id },
        { phone: cleanPhone },
        { phone: flexiblePhoneRegex }
      ]
    });
    if (existingSalon) {
      if (user.role !== 'salon_owner' && user.role !== 'admin') {
        user.role = 'salon_owner';
        await user.save();
      }
      if (!existingSalon.owner) {
        existingSalon.owner = user._id;
        await existingSalon.save();
      }
    }

    console.log(`✅ OTP verified | phone=${maskedNum} | role=${user.role}`);

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET || 'glo_secret',
      { expiresIn: '7d' }
    );

    // Set hardened HttpOnly cookie
    setAuthCookie(res, token);

    res.json({
      success: true,
      token,
      user: { id: user._id, name: user.name, phone: user.phone, role: user.role, mfaEnabled: user.mfaEnabled }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/mfa/setup (protected)
router.post('/mfa/setup', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const mfaData = setupMFA(user.phone || user.name);

    user.mfaSecretEncrypted = mfaData.encryptedSecret;
    user.mfaBackupCodes = mfaData.hashedBackupCodes;
    await user.save();

    res.json({
      success: true,
      otpAuthUrl: mfaData.otpAuthUrl,
      secret: mfaData.secret,
      backupCodes: mfaData.backupCodes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/mfa/verify (protected)
router.post('/mfa/verify', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    const user = await User.findById(req.user._id).select('+mfaSecretEncrypted');

    if (!user.mfaSecretEncrypted) {
      return res.status(400).json({ error: 'MFA is not set up on this account.' });
    }

    const secret = decryptSecret(user.mfaSecretEncrypted);
    const isValid = verifyTOTP(token, secret);

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid authenticator code.' });
    }

    user.mfaEnabled = true;
    await user.save();

    res.json({ success: true, message: 'MFA enabled successfully!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('glo_token', { path: '/' });
  res.clearCookie('__Host-glo_token', { path: '/' });
  res.json({ success: true, message: 'Logged out successfully.' });
});

// GET /api/auth/me (protected)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('bookings');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/profile (protected)
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (name) user.name = name;
    if (email) {
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      user.email = email;
    }
    await user.save();

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/addresses (protected)
router.post('/addresses', authMiddleware, async (req, res) => {
  try {
    const { title, street, city, pincode } = req.body;
    if (!street || !city || !pincode) return res.status(400).json({ error: 'Street, city, and pincode are required.' });
    
    const user = await User.findById(req.user._id);
    user.savedAddresses.push({ title: title || 'Home', street, city, pincode });
    await user.save();
    
    res.json({ success: true, addresses: user.savedAddresses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/auth/addresses/:id (protected)
router.delete('/addresses/:id', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.savedAddresses = user.savedAddresses.filter(addr => addr._id.toString() !== req.params.id);
    await user.save();
    
    res.json({ success: true, addresses: user.savedAddresses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
