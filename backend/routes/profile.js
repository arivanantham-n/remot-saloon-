const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Salon = require('../models/Salon');
const Booking = require('../models/Booking');
const authMiddleware = require('../middleware/auth');
const { requireStrictRole } = require('../middleware/rbac');
const { maskPhone, formatPhoneNumber } = require('../services/sms.service');

// ─── Rate Limiter for Profile Modifications ──────────────────────────────────
const profileUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many profile update requests. Please try again after 15 minutes.' }
});

// ─── Helper: Mask Sensitive Financial Payout Details ──────────────────────────
function maskPayoutDetails(payout) {
  if (!payout) return { accountHolderName: '', accountNumber: '', ifscCode: '', upiId: '' };

  let maskedAcc = '';
  if (payout.accountNumber) {
    const raw = String(payout.accountNumber).trim();
    maskedAcc = raw.length > 4 ? 'XXXXXX' + raw.slice(-4) : 'XXXX';
  }

  let maskedUpi = '';
  if (payout.upiId) {
    const raw = String(payout.upiId).trim();
    const parts = raw.split('@');
    if (parts.length === 2) {
      const userPart = parts[0];
      const maskedUser = userPart.length > 2 ? userPart.slice(0, 2) + '***' : '***';
      maskedUpi = `${maskedUser}@${parts[1]}`;
    } else {
      maskedUpi = raw.length > 4 ? 'XXXX' + raw.slice(-4) : 'XXXX';
    }
  }

  return {
    accountHolderName: payout.accountHolderName || '',
    accountNumber: maskedAcc,
    ifscCode: payout.ifscCode ? payout.ifscCode.toUpperCase() : '',
    upiId: maskedUpi
  };
}

// ─── Helper: Validate Email Format ────────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── Helper: Validate Image Payload (URL or base64 < 2MB) ─────────────────────
function isValidImage(img) {
  if (!img) return true;
  if (typeof img !== 'string') return false;
  // If base64 data URL, ensure under 2.5MB string length (~2MB binary)
  if (img.startsWith('data:image/')) {
    return img.length <= 2.5 * 1024 * 1024;
  }
  // Otherwise must be a valid URL
  return img.startsWith('http://') || img.startsWith('https://') || img.startsWith('/');
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. CLIENT PROFILE ENDPOINTS (role: client only)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/profile/client — Client Profile
router.get('/client', authMiddleware, requireStrictRole('client'), async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-otp -otpExpiry -mfaSecretEncrypted');
    if (!user) {
      return res.status(404).json({ error: 'Client profile not found.' });
    }

    const bookingCount = await Booking.countDocuments({ user: user._id });

    res.json({
      success: true,
      profile: {
        id: user._id,
        name: user.name || 'Guest',
        phone: formatPhoneNumber(user.phone),
        phoneVerified: true,
        email: user.email || '',
        profilePhoto: user.profilePhoto || '',
        role: user.role,
        savedAddresses: user.savedAddresses || [],
        totalBookings: bookingCount,
        bookingHistoryLink: '/my-bookings.html',
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    console.error('❌ GET /profile/client error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve client profile.' });
  }
});

// PATCH /api/profile/client — Update Client Profile
router.patch('/client', authMiddleware, requireStrictRole('client'), profileUpdateLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'Client profile not found.' });

    // Mass-assignment protection: Whitelist allowed fields only
    const { name, email, profilePhoto, savedAddresses } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Full name must be a non-empty string.' });
      }
      if (name.trim().length > 100) {
        return res.status(400).json({ error: 'Full name cannot exceed 100 characters.' });
      }
      user.name = name.trim();
    }

    if (email !== undefined) {
      if (email && (!isValidEmail(email) || email.length > 120)) {
        return res.status(400).json({ error: 'Invalid email address format.' });
      }
      user.email = email ? email.trim().toLowerCase() : '';
    }

    if (profilePhoto !== undefined) {
      if (!isValidImage(profilePhoto)) {
        return res.status(400).json({ error: 'Profile photo must be a valid image URL or base64 image under 2MB.' });
      }
      user.profilePhoto = profilePhoto;
    }

    if (savedAddresses !== undefined) {
      if (!Array.isArray(savedAddresses)) {
        return res.status(400).json({ error: 'savedAddresses must be an array.' });
      }
      user.savedAddresses = savedAddresses;
    }

    await user.save();
    console.log(`👤 Client profile updated | user=${user._id} | phone=${maskPhone(user.phone)}`);

    res.json({
      success: true,
      message: 'Client profile updated successfully.',
      profile: {
        id: user._id,
        name: user.name,
        phone: formatPhoneNumber(user.phone),
        phoneVerified: true,
        email: user.email,
        profilePhoto: user.profilePhoto,
        role: user.role,
        savedAddresses: user.savedAddresses
      }
    });
  } catch (err) {
    console.error('❌ PATCH /profile/client error:', err.message);
    res.status(500).json({ error: 'Failed to update client profile.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. SALON OWNER PROFILE ENDPOINTS (role: salon_owner only)
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/profile/owner — Salon Owner Profile
router.get('/owner', authMiddleware, requireStrictRole('salon_owner'), async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'Salon owner not found.' });

    // Look up salon associated with this owner
    let salon = await Salon.findOne({ owner: user._id }).populate('services');
    
    // Auto-link by phone if owner reference wasn't set previously
    if (!salon && user.phone) {
      const cleanPhone = user.phone.trim();
      const digitsOnly = cleanPhone.replace(/\D/g, '').slice(-10);
      salon = await Salon.findOne({
        $or: [
          { phone: cleanPhone },
          { phone: new RegExp(digitsOnly + '$') }
        ]
      }).populate('services');
      if (salon && !salon.owner) {
        salon.owner = user._id;
        await salon.save();
      }
    }

    if (!salon) {
      return res.json({
        success: true,
        hasSalon: false,
        message: 'No registered salon found for this account. Please register your salon.',
        owner: {
          id: user._id,
          name: user.name,
          phone: formatPhoneNumber(user.phone),
          email: user.email || '',
          role: user.role
        }
      });
    }

    res.json({
      success: true,
      hasSalon: true,
      profile: {
        id: salon._id,
        ownerId: user._id,
        ownerName: salon.ownerName || user.name,
        salonName: salon.name,
        phone: formatPhoneNumber(salon.phone || user.phone),
        phoneVerified: true,
        email: salon.email || user.email || '',
        businessAddress: salon.address,
        city: salon.city || '',
        pincode: salon.pincode || '',
        serviceRadius: salon.serviceRadius || '5 km',
        specialty: salon.specialty || 'Unisex',
        workingHours: salon.workingHours || [],
        logo: salon.logo || '',
        bio: salon.bio || salon.description || '',
        verificationStatus: salon.status, // Read-only: pending | approved | rejected
        rating: salon.rating || 0,
        totalReviews: salon.totalReviews || 0,
        gstin: salon.gstin || '',
        servicesCount: salon.services ? salon.services.length : 0,
        services: salon.services || [],
        servicesListLink: '/catalog.html',
        payoutDetails: maskPayoutDetails(salon.payoutDetails)
      }
    });
  } catch (err) {
    console.error('❌ GET /profile/owner error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve salon owner profile.' });
  }
});

// PATCH /api/profile/owner — Update Salon Owner Profile
router.patch('/owner', authMiddleware, requireStrictRole('salon_owner'), profileUpdateLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    let salon = await Salon.findOne({ owner: user._id });
    if (!salon && user.phone) {
      const cleanPhone = user.phone.trim();
      const digitsOnly = cleanPhone.replace(/\D/g, '').slice(-10);
      salon = await Salon.findOne({
        $or: [
          { phone: cleanPhone },
          { phone: new RegExp(digitsOnly + '$') }
        ]
      });
      if (salon) salon.owner = user._id;
    }

    if (!salon) {
      return res.status(404).json({ error: 'Salon profile not found. Please register your salon first.' });
    }

    // Mass-assignment protection: Whitelist allowed fields only
    // Exclude 'status', 'rating', 'totalReviews', 'phone', 'owner', '_id'
    const {
      ownerName,
      salonName,
      name,
      email,
      address,
      city,
      pincode,
      serviceRadius,
      workingHours,
      logo,
      bio,
      description,
      gstin,
      payoutDetails
    } = req.body;

    if (ownerName !== undefined) {
      if (typeof ownerName !== 'string' || !ownerName.trim()) {
        return res.status(400).json({ error: 'Owner name must be a non-empty string.' });
      }
      salon.ownerName = ownerName.trim();
      user.name = ownerName.trim();
      await user.save();
    }

    const businessName = salonName || name;
    if (businessName !== undefined) {
      if (typeof businessName !== 'string' || !businessName.trim()) {
        return res.status(400).json({ error: 'Salon / Business name must be a non-empty string.' });
      }
      salon.name = businessName.trim();
    }

    if (email !== undefined) {
      if (email && !isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid business email format.' });
      }
      salon.email = email ? email.trim().toLowerCase() : '';
    }

    if (address !== undefined) {
      if (typeof address !== 'string' || !address.trim()) {
        return res.status(400).json({ error: 'Business address cannot be empty.' });
      }
      salon.address = address.trim();
    }

    if (city !== undefined) salon.city = String(city).trim();
    
    if (pincode !== undefined) {
      if (pincode && !/^\d{6}$/.test(String(pincode).trim())) {
        return res.status(400).json({ error: 'Pincode must be a 6-digit number.' });
      }
      salon.pincode = String(pincode).trim();
    }

    if (serviceRadius !== undefined) salon.serviceRadius = String(serviceRadius).trim();
    if (workingHours !== undefined && Array.isArray(workingHours)) salon.workingHours = workingHours;

    if (logo !== undefined) {
      if (!isValidImage(logo)) {
        return res.status(400).json({ error: 'Logo must be a valid image URL or base64 image under 2MB.' });
      }
      salon.logo = logo;
    }

    if (bio !== undefined) salon.bio = String(bio).trim();
    if (description !== undefined) salon.description = String(description).trim();
    if (gstin !== undefined) salon.gstin = String(gstin).trim();

    // Payout details update (only replace if new values provided, ignore mask placeholders)
    if (payoutDetails && typeof payoutDetails === 'object') {
      const current = salon.payoutDetails || {};
      const newAcc = payoutDetails.accountNumber ? String(payoutDetails.accountNumber).trim() : '';
      const newUpi = payoutDetails.upiId ? String(payoutDetails.upiId).trim() : '';

      salon.payoutDetails = {
        accountHolderName: payoutDetails.accountHolderName !== undefined 
          ? String(payoutDetails.accountHolderName).trim() 
          : (current.accountHolderName || ''),
        accountNumber: (newAcc && !newAcc.includes('XXXX')) 
          ? newAcc 
          : (current.accountNumber || ''),
        ifscCode: payoutDetails.ifscCode !== undefined 
          ? String(payoutDetails.ifscCode).trim().toUpperCase() 
          : (current.ifscCode || ''),
        upiId: (newUpi && !newUpi.includes('***') && !newUpi.includes('XXXX')) 
          ? newUpi 
          : (current.upiId || '')
      };
    }

    await salon.save();
    console.log(`💈 Salon owner profile updated | salonId=${salon._id} | owner=${user._id} | phone=${maskPhone(salon.phone)}`);

    res.json({
      success: true,
      message: 'Salon Owner profile updated successfully.',
      profile: {
        id: salon._id,
        ownerId: user._id,
        ownerName: salon.ownerName,
        salonName: salon.name,
        phone: formatPhoneNumber(salon.phone || user.phone),
        phoneVerified: true,
        email: salon.email,
        businessAddress: salon.address,
        city: salon.city,
        pincode: salon.pincode,
        serviceRadius: salon.serviceRadius,
        specialty: salon.specialty,
        workingHours: salon.workingHours,
        logo: salon.logo,
        bio: salon.bio,
        verificationStatus: salon.status,
        gstin: salon.gstin,
        payoutDetails: maskPayoutDetails(salon.payoutDetails)
      }
    });
  } catch (err) {
    console.error('❌ PATCH /profile/owner error:', err.message);
    res.status(500).json({ error: 'Failed to update salon owner profile.' });
  }
});

module.exports = router;
