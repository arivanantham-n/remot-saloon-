const router = require('express').Router();
const Review = require('../models/Review');
const Booking = require('../models/Booking');
const authMiddleware = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { cache, clearCache } = require('../middleware/cache');

const mongoose = require('mongoose');

// GET /api/reviews/salon/:salonId — cached for 60s
router.get('/salon/:salonId', cache(60), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.salonId)) {
      return res.json({ success: true, count: 0, reviews: [] });
    }
    const reviews = await Review.find({ salon: req.params.salonId, isApproved: true })
      .sort({ createdAt: -1 })
      .populate('user', 'name')
      .populate('service', 'name')
      .lean();
    res.json({ success: true, count: reviews.length, reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reviews — post a review (protected)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { salonId, serviceId, bookingId, rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });

    // Check for duplicate
    const exists = await Review.findOne({ user: req.user._id, salon: salonId, booking: bookingId }).lean();
    if (exists) return res.status(409).json({ error: 'You have already reviewed this booking' });

    // Check if booking is verified
    let isVerified = false;
    if (bookingId) {
      const booking = await Booking.findOne({ _id: bookingId, user: req.user._id, status: 'completed' }).lean();
      isVerified = !!booking;
    }

    const review = new Review({
      user: req.user._id,
      salon: salonId,
      service: serviceId,
      booking: bookingId,
      rating,
      comment,
      isVerified
    });
    await review.save();
    clearCache('/reviews');
    clearCache('/salons');
    res.status(201).json({ success: true, review });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/reviews/admin/all — admin
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const reviews = await Review.find({}).sort({ createdAt: -1 })
      .populate('user', 'name phone')
      .populate('salon', 'name')
      .populate('service', 'name')
      .lean();
    res.json({ success: true, reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reviews/:id/toggle — admin approve/reject
router.patch('/:id/toggle', adminAuth, async (req, res) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    review.isApproved = !review.isApproved;
    await review.save();
    clearCache('/reviews');
    clearCache('/salons');
    res.json({ success: true, review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
