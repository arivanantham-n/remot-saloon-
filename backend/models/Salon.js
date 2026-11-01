const mongoose = require('mongoose');

const WorkingHoursSchema = new mongoose.Schema({
  day: { type: String, enum: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
  open: String,
  close: String,
  isClosed: { type: Boolean, default: false }
}, { _id: false });

const PayoutDetailsSchema = new mongoose.Schema({
  accountHolderName: { type: String, trim: true, default: '' },
  accountNumber: { type: String, trim: true, default: '' },
  ifscCode: { type: String, trim: true, default: '' },
  upiId: { type: String, trim: true, default: '' }
}, { _id: false });

const SalonSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true, trim: true },
  ownerName: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, trim: true, lowercase: true },
  gstin: { type: String, trim: true },
  address: { type: String, required: true },
  city: { type: String, trim: true },
  pincode: { type: String, trim: true },
  specialty: { type: String, enum: ['Unisex', 'Women Only', 'Men Only'], default: 'Unisex' },
  serviceRadius: { type: String, default: '5 km' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  rating: { type: Number, default: 0 },
  totalReviews: { type: Number, default: 0 },
  workingHours: [WorkingHoursSchema],
  services: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
  images: [String],
  description: { type: String },
  logo: { type: String, trim: true, default: '' },
  bio: { type: String, trim: true, default: '' },
  payoutDetails: { type: PayoutDetailsSchema, default: () => ({}) }
});

// Indexes for geo/status/rating queries under high concurrency
SalonSchema.index({ status: 1, rating: -1 });
SalonSchema.index({ pincode: 1, status: 1 });
SalonSchema.index({ phone: 1 });

module.exports = mongoose.model('Salon', SalonSchema);
