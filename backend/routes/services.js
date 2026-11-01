const router = require('express').Router();
const Service = require('../models/Service');
const adminAuth = require('../middleware/adminAuth');
const { cache, clearCache } = require('../middleware/cache');

// GET /api/services  — public, with filters, cached for 120s
router.get('/', cache(120), async (req, res) => {
  try {
    const { category, sort, search } = req.query;
    let query = { isActive: true };
    if (category && category !== 'All') query.category = category;
    if (search) query.name = { $regex: search, $options: 'i' };

    let sortObj = {};
    if (sort === 'price_asc')  sortObj = { basePrice: 1 };
    else if (sort === 'price_desc') sortObj = { basePrice: -1 };
    else if (sort === 'popular') sortObj = { popularity: -1 };
    else sortObj = { createdAt: -1 };

    // Use .lean() for fast JSON serialization under high concurrency
    const services = await Service.find(query).sort(sortObj).lean();
    res.json({ success: true, count: services.length, services });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/services/:id — cached for 120s
router.get('/:id', cache(120), async (req, res) => {
  try {
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const service = await Service.findById(req.params.id).lean();
    if (!service) return res.status(404).json({ error: 'Service not found' });
    res.json({ success: true, service });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/services  — admin only
router.post('/', adminAuth, async (req, res) => {
  try {
    const service = new Service(req.body);
    await service.save();
    clearCache('/services');
    res.status(201).json({ success: true, service });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/services/:id  — admin only
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const service = await Service.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!service) return res.status(404).json({ error: 'Service not found' });
    clearCache('/services');
    res.json({ success: true, service });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/services/:id  — admin only (soft delete)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await Service.findByIdAndUpdate(req.params.id, { isActive: false });
    clearCache('/services');
    res.json({ success: true, message: 'Service deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
