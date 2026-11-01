const mongoose = require('mongoose');

const PriceTierSchema = new mongoose.Schema({
  lengthTier: { type: String, enum: ['short', 'medium', 'long', 'N/A'], default: 'N/A' },
  productTier: { type: String, enum: ['normal', 'premium', 'luxury'], default: 'normal' },
  price: { type: Number, required: true }
}, { _id: false });

const ServiceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, enum: ['Women', 'Men', 'Unisex'], required: true },
  subcategory: { type: String, trim: true },
  description: { type: String },
  duration: { type: String },      // e.g. "45-90 mins"
  basePrice: { type: Number, required: true },
  priceTiers: [PriceTierSchema],
  tags: [String],
  isActive: { type: Boolean, default: true },
  popularity: { type: Number, default: 0 },
  images: [String]
}, { timestamps: true });

// Virtual: lowest price
ServiceSchema.virtual('lowestPrice').get(function () {
  if (!this.priceTiers || this.priceTiers.length === 0) return this.basePrice;
  return Math.min(...this.priceTiers.map(t => t.price));
});

// Compound & text indexes for 1000+ concurrent search/filter queries
ServiceSchema.index({ category: 1, isActive: 1, popularity: -1 });
ServiceSchema.index({ name: 'text', description: 'text', tags: 'text' });
ServiceSchema.index({ basePrice: 1 });

module.exports = mongoose.model('Service', ServiceSchema);
