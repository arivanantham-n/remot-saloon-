const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  bookingId: { type: String, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true },
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  // Variants chosen
  hairLength: { type: String, enum: ['short', 'medium', 'long', 'N/A'], default: 'N/A' },
  productTier: { type: String, enum: ['normal', 'premium', 'luxury'], default: 'normal' },
  // Booking slot
  date: { type: String, required: true },    // "2026-09-25"
  timeSlot: { type: String, required: true }, // "11:00 AM"
  staffPreference: { type: String },
  // Pricing
  totalPrice: { type: Number, required: true },
  paymentMethod: { type: String, default: 'Pay at Salon' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'refunded', 'failed'], default: 'pending' },
  // Razorpay payment tracking
  razorpayOrderId:   { type: String, index: true },
  razorpayPaymentId: { type: String, index: true },
  razorpaySignature: { type: String },
  // Status
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled'], default: 'confirmed' },
  notes: { type: String },
  address: { type: String }
}, { timestamps: true });

// Auto-generate booking ID
BookingSchema.pre('save', async function (next) {
  if (!this.bookingId) {
    const count = await mongoose.model('Booking').countDocuments();
    this.bookingId = `GLO-${String(count + 1001).padStart(5, '0')}`;
  }
  next();
});

// Indexes for high concurrency slot lookups and user booking queries
BookingSchema.index({ user: 1, createdAt: -1 });
BookingSchema.index({ salon: 1, date: 1, status: 1 });
BookingSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Booking', BookingSchema);
