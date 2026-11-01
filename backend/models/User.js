const mongoose = require('mongoose');
const { encrypt, decrypt, generateBlindIndex } = require('../services/encryption.service');

const AddressSchema = new mongoose.Schema({
  title: { type: String, trim: true, default: 'Home' },
  street: { type: String, trim: true, required: true },
  city: { type: String, trim: true, required: true },
  pincode: { type: String, trim: true, required: true }
}, { _id: true });

const UserSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: 'Guest' },
  
  // Encrypted phone number (PII Protection at rest)
  phone: { 
    type: String, 
    required: true,
    set: function(val) {
      if (!val) return val;
      this.phoneBlindIndex = generateBlindIndex(val);
      return encrypt(val);
    },
    get: function(val) {
      return decrypt(val);
    }
  },
  phoneBlindIndex: { type: String, index: true },

  // Encrypted email
  email: { 
    type: String, 
    trim: true, 
    lowercase: true,
    set: function(val) {
      if (!val) return val;
      this.emailBlindIndex = generateBlindIndex(val);
      return encrypt(val);
    },
    get: function(val) {
      return decrypt(val);
    }
  },
  emailBlindIndex: { type: String, index: true },

  role: { 
    type: String, 
    enum: ['client', 'staff', 'salon_owner', 'admin'], 
    default: 'client' 
  },

  passwordHash: { type: String, select: false },

  // MFA Authentication
  mfaEnabled: { type: Boolean, default: false },
  mfaSecretEncrypted: { type: String, select: false },
  mfaBackupCodes: [{ type: String, select: false }],

  // OTP Verification
  otp: { type: String, select: false },
  otpExpiry: { type: Date, select: false },
  otpAttempts: { type: Number, default: 0, select: false },
  otpLockedUntil: { type: Date, select: false },
  lastOtpSentAt: { type: Date, select: false },
  isVerified: { type: Boolean, default: false },

  savedAddresses: [AddressSchema],
  favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
  profilePhoto: { type: String, trim: true, default: '' }
}, { 
  timestamps: true,
  toJSON: { getters: true, virtuals: true },
  toObject: { getters: true, virtuals: true }
});

// Virtual for booking history
UserSchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'user'
});

module.exports = mongoose.model('User', UserSchema);
