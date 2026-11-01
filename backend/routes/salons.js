const router = require('express').Router();
const Salon = require('../models/Salon');
const adminAuth = require('../middleware/adminAuth');
const authMiddleware = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const { cache, clearCache } = require('../middleware/cache');

// GET /api/salons/my-salon — Salon Owner: get own salon
router.get('/my-salon', authMiddleware, requireRoles('salon_owner', 'admin'), async (req, res) => {
  try {
    const salon = await Salon.findOne({ owner: req.user._id }).populate('services').lean();
    if (!salon) return res.status(404).json({ error: 'Salon not found for this user.' });
    res.json({ success: true, salon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/salons/my-salon — Salon Owner: update own salon
router.put('/my-salon', authMiddleware, requireRoles('salon_owner', 'admin'), async (req, res) => {
  try {
    const { name, ownerName, phone, email, address, city, pincode, gstin, workingHours } = req.body;
    let salon = await Salon.findOne({ owner: req.user._id });
    if (!salon) return res.status(404).json({ error: 'Salon not found.' });

    if (name) salon.name = name;
    if (ownerName) salon.ownerName = ownerName;
    if (phone) {
      if (!/^\+?[1-9]\d{6,14}$/.test(phone.trim())) return res.status(400).json({ error: 'Invalid phone number format' });
      salon.phone = phone.trim();
    }
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email format' });
      salon.email = email;
    }
    if (address) salon.address = address;
    if (city) salon.city = city;
    if (pincode) salon.pincode = pincode;
    if (gstin !== undefined) salon.gstin = gstin;
    if (workingHours) salon.workingHours = workingHours;

    await salon.save();
    clearCache('/salons');
    res.json({ success: true, salon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salons  — public, cached for 60s
router.get('/', cache(60), async (req, res) => {
  try {
    const { specialty, status } = req.query;
    let query = {};
    if (specialty) query.specialty = specialty;
    if (status) query.status = status;
    else query.status = 'approved'; // default: only show approved

    const salons = await Salon.find(query).sort({ rating: -1 }).lean();
    res.json({ success: true, count: salons.length, salons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salons/:id — cached for 60s
router.get('/:id', cache(60), async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'Salon not found' });
    }
    const salon = await Salon.findById(req.params.id).populate('services').lean();
    if (!salon) return res.status(404).json({ error: 'Salon not found' });
    res.json({ success: true, salon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/salons/register — public salon registration
router.post('/register', async (req, res) => {
  try {
    const { phone, email } = req.body;
    if (!phone || !/^\+?[1-9]\d{6,14}$/.test(phone.trim())) {
      return res.status(400).json({ error: 'A valid phone number is required.' });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    const existing = await Salon.findOne({ phone: phone.trim() }).lean();
    if (existing) return res.status(409).json({ error: 'A salon with this phone number is already registered.' });

    const salon = new Salon({
      ...req.body,
      status: 'pending',
      workingHours: req.body.workingHours || [
        { day: 'Mon', open: '09:00', close: '20:00' },
        { day: 'Tue', open: '09:00', close: '20:00' },
        { day: 'Wed', open: '09:00', close: '20:00' },
        { day: 'Thu', open: '09:00', close: '20:00' },
        { day: 'Fri', open: '09:00', close: '20:00' },
        { day: 'Sat', open: '10:00', close: '18:00' },
        { day: 'Sun', open: '10:00', close: '17:00', isClosed: true }
      ]
    });
    await salon.save();
    clearCache('/salons');
    res.status(201).json({
      success: true,
      message: 'Salon registered successfully! We will review and approve within 24 hours.',
      salon
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/salons/:id/approve  — admin only
router.patch('/:id/approve', adminAuth, async (req, res) => {
  try {
    const salon = await Salon.findByIdAndUpdate(req.params.id, { status: 'approved' }, { new: true });
    clearCache('/salons');
    res.json({ success: true, salon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/salons/:id/reject  — admin only
router.patch('/:id/reject', adminAuth, async (req, res) => {
  try {
    const salon = await Salon.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
    clearCache('/salons');
    res.json({ success: true, salon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/salons/admin/all  — admin: all salons including pending
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const salons = await Salon.find({}).sort({ createdAt: -1 }).lean();
    res.json({ success: true, salons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
