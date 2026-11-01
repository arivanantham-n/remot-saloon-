const router = require('express').Router();
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const Salon = require('../models/Salon');
const authMiddleware = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { sendSMS, maskPhone } = require('../services/sms.service');

/**
 * Notify salon owner via SMS about a new booking.
 * Runs asynchronously — failures are logged but never block the client response.
 */
async function notifySalonOwner(booking, clientUser) {
  try {
    const salonPhone = booking.salon?.phone;
    if (!salonPhone) {
      console.warn(`⚠️  Owner notification skipped: no salon phone | bookingId=${booking.bookingId}`);
      return;
    }

    const clientName = clientUser.name || 'Guest';
    const clientPhone = clientUser.phone || 'N/A';
    const serviceName = booking.service?.name || 'Service';
    const dateTime = `${booking.date} at ${booking.timeSlot}`;
    const address = booking.address || 'Not provided';
    const price = booking.totalPrice;

    const msg = [
      `New Booking Alert!`,
      `Booking: ${booking.bookingId}`,
      `Client: ${clientName}`,
      `Phone: ${clientPhone}`,
      `Service: ${serviceName}`,
      `Date: ${dateTime}`,
      `Address: ${address}`,
      `Total: Rs.${price}`,
      `- Glo Salon`
    ].join('\n');

    const sent = await sendSMS(salonPhone, msg);
    if (sent) {
      console.log(`✅ Owner notified | bookingId=${booking.bookingId} | salon=${booking.salon.name} | phone=${maskPhone(salonPhone)}`);
    }
  } catch (err) {
    console.error(`⚠️  Owner notification error | bookingId=${booking.bookingId} | error=${err.message}`);
  }
}

// GET /api/slots/:serviceId/:date — available time slots for a date
router.get('/slots/:serviceId/:date', async (req, res) => {
  try {
    const { serviceId, date } = req.params;
    const { salonId } = req.query;

    // Get all booked slots for this date + salon with .lean()
    const booked = await Booking.find({ date, salon: salonId, status: { $ne: 'cancelled' } })
      .select('timeSlot')
      .lean();
    const bookedSlots = booked.map(b => b.timeSlot);

    // Generate time slots from 9 AM to 8 PM in 30-min increments
    const slots = [];
    for (let h = 9; h <= 20; h++) {
      for (let m of ['00', '30']) {
        if (h === 20 && m === '30') continue;
        const hour12 = h > 12 ? h - 12 : h;
        const ampm = h >= 12 ? 'PM' : 'AM';
        const label = `${hour12}:${m} ${ampm}`;
        slots.push({ time: label, available: !bookedSlots.includes(label) });
      }
    }
    res.json({ success: true, date, slots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookings — create booking (protected)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { serviceId, salonId, date, timeSlot, hairLength, productTier, address, notes, staffPreference } = req.body;

    // Validate slot not already taken
    const conflict = await Booking.findOne({ salon: salonId, date, timeSlot, status: { $ne: 'cancelled' } }).lean();
    if (conflict) return res.status(409).json({ error: 'This slot is already booked. Please choose another time.' });

    // Calculate price from service price tiers
    const service = await Service.findById(serviceId).lean();
    if (!service) return res.status(404).json({ error: 'Service not found' });

    let price = service.basePrice;
    if (hairLength && hairLength !== 'N/A' && productTier) {
      const tier = service.priceTiers.find(t => t.lengthTier === hairLength && t.productTier === productTier);
      if (tier) price = tier.price;
    }

    const booking = new Booking({
      user: req.user._id,
      salon: salonId,
      service: serviceId,
      hairLength: hairLength || 'N/A',
      productTier: productTier || 'normal',
      date,
      timeSlot,
      totalPrice: price,
      address,
      notes,
      staffPreference
    });
    await booking.save();

    // Increment service popularity
    await Service.findByIdAndUpdate(serviceId, { $inc: { popularity: 1 } });

    const populated = await Booking.findById(booking._id)
      .populate('service', 'name duration')
      .populate('salon', 'name phone address')
      .lean();

    // Async salon owner notification (non-blocking — failure never affects client response)
    notifySalonOwner(populated, req.user).catch(err => {
      console.error(`⚠️  Owner notification failed | bookingId=${populated.bookingId} | error=${err.message}`);
    });

    res.status(201).json({ success: true, booking: populated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/bookings/my — user's own bookings (protected)
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('service', 'name duration category')
      .populate('salon', 'name address phone rating')
      .lean();
    res.json({ success: true, bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/bookings/:id/cancel — cancel a booking (protected)
router.patch('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const booking = await Booking.findOne({ _id: req.params.id, user: req.user._id });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status === 'completed') return res.status(400).json({ error: 'Cannot cancel a completed booking' });
    booking.status = 'cancelled';
    await booking.save();
    res.json({ success: true, message: 'Booking cancelled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bookings/admin/all — admin: all bookings
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    let query = {};
    if (status) query.status = status;

    const total = await Booking.countDocuments(query);
    const bookings = await Booking.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('user', 'name phone')
      .populate('service', 'name category')
      .populate('salon', 'name')
      .lean();

    res.json({ success: true, total, page: Number(page), bookings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
