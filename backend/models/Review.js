const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  salon: { type: mongoose.Schema.Types.ObjectId, ref: 'Salon', required: true },
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service' },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, trim: true },
  photos: [String],
  isVerified: { type: Boolean, default: false }, // verified booking badge
  isApproved: { type: Boolean, default: true }
}, { timestamps: true });

// After saving, update salon's average rating
ReviewSchema.post('save', async function () {
  const Salon = require('./Salon');
  const agg = await mongoose.model('Review').aggregate([
    { $match: { salon: this.salon, isApproved: true } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);
  if (agg.length) {
    await Salon.findByIdAndUpdate(this.salon, {
      rating: parseFloat(agg[0].avg.toFixed(1)),
      totalReviews: agg[0].count
    });
  }
});

// Indexes for rapid review aggregation and salon review lookups
ReviewSchema.index({ salon: 1, isApproved: 1, createdAt: -1 });
ReviewSchema.index({ user: 1 });

module.exports = mongoose.model('Review', ReviewSchema);
