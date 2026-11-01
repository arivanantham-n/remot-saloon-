const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const Booking = require('../models/Booking');
const auth = require('../middleware/auth');

// ─── Initialize Razorpay SDK ─────────────────────────────────────────────────
// Real keys: rzp_live_xxxxx / rzp_test_xxxxx (from Razorpay Dashboard)
// Demo keys (contains 'demo'): skip SDK initialization for local dev without account
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const isDemoMode = !RAZORPAY_KEY_ID || RAZORPAY_KEY_ID.includes('demo');

let razorpay = null;
if (!isDemoMode) {
  razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
  });
  console.log('💳 Razorpay initialized with key:', RAZORPAY_KEY_ID.substring(0, 12) + '…');
} else {
  console.log('⚠️  Razorpay running in DEMO mode — no real payments will be processed.');
}

// ─── GET /api/payments/config ─────────────────────────────────────────────────
// Returns the public Razorpay Key ID to the frontend for Checkout.js initialization
router.get('/config', (req, res) => {
  res.json({
    keyId: RAZORPAY_KEY_ID || 'rzp_test_demo',
    liveMode: !isDemoMode
  });
});

// ─── POST /api/payments/create-order ──────────────────────────────────────────
// Creates a Razorpay Order for a booking. Frontend uses the order_id to open Checkout.
router.post('/create-order', auth, async (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({ error: 'bookingId is required' });
    }

    const booking = await Booking.findById(bookingId)
      .populate('service', 'name')
      .populate('salon', 'name');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Verify ownership — the logged-in user must own this booking
    if (booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized: You do not own this booking.' });
    }

    // Prevent double-payment
    if (booking.paymentStatus === 'paid') {
      return res.status(400).json({ error: 'This booking has already been paid for.' });
    }

    // Razorpay accepts amount in lowest currency unit (paise for INR: ₹699 = 69900 paise)
    const amountInPaise = Math.round(booking.totalPrice * 100);
    const currency = 'INR';
    const receipt = `rcpt_${booking._id.toString().substring(0, 10)}_${Date.now()}`;

    let orderData;

    if (razorpay) {
      // ────── REAL Razorpay Order Creation ──────
      const order = await razorpay.orders.create({
        amount: amountInPaise,
        currency,
        receipt,
        payment_capture: 1, // Auto-capture payment on success
        notes: {
          bookingId: booking._id.toString(),
          bookingCode: booking.bookingId,
          serviceName: booking.service?.name || 'Salon Service',
          salonName: booking.salon?.name || 'Glö Salon'
        }
      });

      orderData = {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
        status: order.status
      };
    } else {
      // ────── DEMO Mode Fallback ──────
      orderData = {
        id: `order_demo_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        amount: amountInPaise,
        currency,
        receipt,
        status: 'created'
      };
    }

    // Persist the Razorpay Order ID on the booking
    booking.razorpayOrderId = orderData.id;
    booking.paymentMethod = 'Razorpay';
    await booking.save();

    res.json({
      success: true,
      order: orderData,
      keyId: RAZORPAY_KEY_ID || 'rzp_test_demo',
      booking: {
        id: booking._id,
        bookingCode: booking.bookingId,
        serviceName: booking.service?.name || 'Service',
        salonName: booking.salon?.name || 'Salon',
        totalPrice: booking.totalPrice,
      }
    });
  } catch (err) {
    console.error('❌ Error creating Razorpay order:', err);
    res.status(500).json({ error: err.description || err.message || 'Failed to create payment order' });
  }
});

// ─── POST /api/payments/verify ────────────────────────────────────────────────
// Verifies the Razorpay payment signature (HMAC SHA256) and confirms the booking.
// This is the CRITICAL security check — without valid signature, payment is rejected.
router.post('/verify', auth, async (req, res) => {
  try {
    const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing required payment verification fields.' });
    }

    const booking = await Booking.findById(bookingId)
      .populate('service', 'name')
      .populate('salon', 'name');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Verify ownership
    if (booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Verify order_id matches what we stored
    if (booking.razorpayOrderId && booking.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({ error: 'Order ID mismatch — possible tampering detected.' });
    }

    let isSignatureValid = false;

    if (razorpay && RAZORPAY_KEY_SECRET) {
      // ────── Cryptographic HMAC SHA256 Signature Verification ──────
      // Razorpay sends: SHA256(order_id + "|" + payment_id, secret) = signature
      const body = razorpay_order_id + '|' + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');

      // Timing-safe comparison to prevent timing side-channel attacks
      const sigBuffer = Buffer.from(razorpay_signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      if (sigBuffer.length === expectedBuffer.length) {
        isSignatureValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
      }
    } else {
      // Demo mode — accept all
      isSignatureValid = true;
    }

    if (!isSignatureValid) {
      // Log failed verification attempt (security audit)
      console.warn(`⚠️  PAYMENT SIGNATURE MISMATCH for booking ${booking.bookingId}:`, {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        ip: req.ip
      });
      booking.paymentStatus = 'failed';
      await booking.save();
      return res.status(400).json({ error: 'Payment signature verification failed. Payment rejected.' });
    }

    // ────── Payment Verified Successfully ──────
    booking.paymentStatus = 'paid';
    booking.paymentMethod = 'Razorpay';
    booking.status = 'confirmed';
    booking.razorpayPaymentId = razorpay_payment_id;
    booking.razorpaySignature = razorpay_signature;
    await booking.save();

    console.log(`✅ Payment verified for ${booking.bookingId}: ₹${booking.totalPrice} (${razorpay_payment_id})`);

    res.json({
      success: true,
      message: 'Payment verified successfully! Your appointment is confirmed.',
      booking
    });
  } catch (err) {
    console.error('❌ Error verifying payment:', err);
    res.status(500).json({ error: err.message || 'Payment verification failed' });
  }
});

// ─── POST /api/payments/refund ────────────────────────────────────────────────
// Initiates a full refund for a paid booking via Razorpay Refund API
router.post('/refund', auth, async (req, res) => {
  try {
    const { bookingId } = req.body;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.paymentStatus !== 'paid' || !booking.razorpayPaymentId) {
      return res.status(400).json({ error: 'This booking has no paid Razorpay transaction to refund.' });
    }

    if (!razorpay) {
      return res.status(400).json({ error: 'Razorpay is not configured. Cannot process refund.' });
    }

    // Create a full refund via Razorpay API
    const refund = await razorpay.payments.refund(booking.razorpayPaymentId, {
      speed: 'normal',
      notes: {
        bookingId: booking._id.toString(),
        reason: 'Customer requested cancellation'
      }
    });

    booking.paymentStatus = 'refunded';
    booking.status = 'cancelled';
    await booking.save();

    console.log(`💰 Refund processed for ${booking.bookingId}: ₹${booking.totalPrice} → ${refund.id}`);

    res.json({
      success: true,
      message: `Refund of ₹${booking.totalPrice} initiated. It may take 5–7 business days to reflect.`,
      refundId: refund.id,
      booking
    });
  } catch (err) {
    console.error('❌ Error processing refund:', err);
    res.status(500).json({ error: err.description || err.message || 'Refund failed' });
  }
});

// ─── POST /api/payments/webhook ───────────────────────────────────────────────
// Razorpay Webhook endpoint — receives server-to-server payment event notifications.
// Configure this URL in your Razorpay Dashboard → Webhooks → https://yourdomain.com/api/payments/webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (webhookSecret) {
      // Verify webhook signature
      const shasum = crypto.createHmac('sha256', webhookSecret);
      shasum.update(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      const digest = shasum.digest('hex');
      const receivedSignature = req.headers['x-razorpay-signature'];

      if (digest !== receivedSignature) {
        console.warn('⚠️  Webhook signature mismatch — ignoring event.');
        return res.status(400).json({ error: 'Invalid webhook signature' });
      }
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    switch (event.event) {
      case 'payment.captured': {
        const payment = event.payload.payment.entity;
        const orderId = payment.order_id;

        const booking = await Booking.findOne({ razorpayOrderId: orderId });
        if (booking && booking.paymentStatus !== 'paid') {
          booking.paymentStatus = 'paid';
          booking.razorpayPaymentId = payment.id;
          booking.status = 'confirmed';
          await booking.save();
          console.log(`🔔 Webhook: Payment captured for ${booking.bookingId}`);
        }
        break;
      }

      case 'payment.failed': {
        const payment = event.payload.payment.entity;
        const orderId = payment.order_id;

        const booking = await Booking.findOne({ razorpayOrderId: orderId });
        if (booking) {
          booking.paymentStatus = 'failed';
          await booking.save();
          console.log(`🔔 Webhook: Payment failed for ${booking.bookingId}`);
        }
        break;
      }

      case 'refund.processed': {
        const refund = event.payload.refund.entity;
        const paymentId = refund.payment_id;

        const booking = await Booking.findOne({ razorpayPaymentId: paymentId });
        if (booking) {
          booking.paymentStatus = 'refunded';
          booking.status = 'cancelled';
          await booking.save();
          console.log(`🔔 Webhook: Refund processed for ${booking.bookingId}`);
        }
        break;
      }

      default:
        console.log(`🔔 Webhook event received: ${event.event}`);
    }

    // Always respond 200 to acknowledge receipt (Razorpay retries on non-2xx)
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.json({ status: 'ok' }); // Still respond 200 to prevent Razorpay retries
  }
});

// ─── GET /api/payments/status/:bookingId ──────────────────────────────────────
// Check payment status for a specific booking
router.get('/status/:bookingId', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    if (booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = {
      bookingId: booking.bookingId,
      paymentStatus: booking.paymentStatus,
      paymentMethod: booking.paymentMethod,
      totalPrice: booking.totalPrice,
      razorpayOrderId: booking.razorpayOrderId || null,
      razorpayPaymentId: booking.razorpayPaymentId || null
    };

    // If Razorpay is live, fetch latest payment status from Razorpay API
    if (razorpay && booking.razorpayPaymentId) {
      try {
        const payment = await razorpay.payments.fetch(booking.razorpayPaymentId);
        result.razorpayStatus = payment.status;
        result.razorpayMethod = payment.method;
      } catch (_) { /* ignore if Razorpay API is unavailable */ }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
