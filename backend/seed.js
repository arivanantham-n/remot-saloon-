require('dotenv').config();
const mongoose = require('mongoose');
const Service = require('./models/Service');
const Salon = require('./models/Salon');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/glo-salon';

const services = [
  // ── WOMEN ──────────────────────────────────────────────────────────────────
  {
    name: 'Advanced Hair Styling & Treatments',
    category: 'Women',
    subcategory: 'Hair Care',
    description: 'Detailed care, custom layers, blow-dry, global hair coloring, balayage, keratin, and deep conditioning spa treatments by certified stylists.',
    duration: '45–90 mins',
    basePrice: 599,
    priceTiers: [
      { lengthTier: 'short',  productTier: 'normal',  price: 599 },
      { lengthTier: 'short',  productTier: 'premium', price: 899 },
      { lengthTier: 'short',  productTier: 'luxury',  price: 1299 },
      { lengthTier: 'medium', productTier: 'normal',  price: 799 },
      { lengthTier: 'medium', productTier: 'premium', price: 1199 },
      { lengthTier: 'medium', productTier: 'luxury',  price: 1699 },
      { lengthTier: 'long',   productTier: 'normal',  price: 999 },
      { lengthTier: 'long',   productTier: 'premium', price: 1499 },
      { lengthTier: 'long',   productTier: 'luxury',  price: 2199 }
    ],
    tags: ['hair', 'styling', 'coloring', 'keratin', 'balayage'],
    popularity: 42
  },
  {
    name: 'Luxury Facials & De-Tan',
    category: 'Women',
    subcategory: 'Skin & Facial',
    description: 'Fruit cleanups, herbal facials, anti-aging gold & diamond treatments, hydrafacial, and full body bleach & de-tan with professional-grade products.',
    duration: '60 mins',
    basePrice: 799,
    priceTiers: [
      { lengthTier: 'N/A', productTier: 'normal',  price: 799 },
      { lengthTier: 'N/A', productTier: 'premium', price: 1299 },
      { lengthTier: 'N/A', productTier: 'luxury',  price: 1999 }
    ],
    tags: ['facial', 'skin', 'de-tan', 'glow', 'hydrafacial'],
    popularity: 38
  },
  {
    name: 'Rica & Chocolate Waxing & Threading',
    category: 'Women',
    subcategory: 'Waxing & Hair Removal',
    description: 'Full arms, full legs, underarms, bikini wax with painless Rica/Chocolate formulas, plus precise eyebrow threading and full face care.',
    duration: '30–60 mins',
    basePrice: 349,
    priceTiers: [
      { lengthTier: 'N/A', productTier: 'normal',  price: 349 },
      { lengthTier: 'N/A', productTier: 'premium', price: 599 }
    ],
    tags: ['waxing', 'threading', 'hair removal', 'rica', 'chocolate wax'],
    popularity: 55
  },
  {
    name: 'Spa Manicure & Pedicure',
    category: 'Women',
    subcategory: 'Hands & Feet',
    description: 'Classic mani-pedi, deep scrub, relaxing mask, massage, gel polish application, nail art, and nail extensions.',
    duration: '45 mins',
    basePrice: 699,
    priceTiers: [
      { lengthTier: 'N/A', productTier: 'normal',  price: 699 },
      { lengthTier: 'N/A', productTier: 'premium', price: 1099 },
      { lengthTier: 'N/A', productTier: 'luxury',  price: 1599 }
    ],
    tags: ['manicure', 'pedicure', 'nails', 'gel', 'nail art'],
    popularity: 29
  },
  {
    name: 'Party & Bridal Makeup',
    category: 'Women',
    subcategory: 'Makeup & Styling',
    description: 'Professional party makeup, engagement makeup, bridal packages, saree & dupatta draping, and intricate bridal hair styling.',
    duration: '90–120 mins',
    basePrice: 1499,
    priceTiers: [
      { lengthTier: 'N/A', productTier: 'normal',  price: 1499 },
      { lengthTier: 'N/A', productTier: 'premium', price: 2499 },
      { lengthTier: 'N/A', productTier: 'luxury',  price: 4999 }
    ],
    tags: ['makeup', 'bridal', 'party', 'saree draping'],
    popularity: 61
  },
  {
    name: 'Keratin & Deep Moisture Hair Spa',
    category: 'Women',
    subcategory: 'Hair Care',
    description: 'Intense keratin infusion, anti-frizz smoothening, argan oil deep hydration, and revitalizing scalp massage for silky, manageable hair.',
    duration: '60–90 mins',
    basePrice: 1199,
    priceTiers: [
      { lengthTier: 'short',  productTier: 'normal',  price: 1199 },
      { lengthTier: 'short',  productTier: 'premium', price: 1699 },
      { lengthTier: 'medium', productTier: 'normal',  price: 1499 },
      { lengthTier: 'medium', productTier: 'premium', price: 2099 },
      { lengthTier: 'long',   productTier: 'normal',  price: 1899 },
      { lengthTier: 'long',   productTier: 'premium', price: 2599 }
    ],
    tags: ['hair spa', 'keratin', 'smoothening', 'anti-frizz', 'hair care'],
    popularity: 65
  },
  // ── MEN ────────────────────────────────────────────────────────────────────
  {
    name: 'Haircut & Beard Styling',
    category: 'Men',
    subcategory: "Men's Hair & Beard",
    description: 'Precision men\'s haircut, professional beard trimming, sharp shaving, grey coverage coloring, and revitalizing scalp treatments.',
    duration: '30–45 mins',
    basePrice: 399,
    priceTiers: [
      { lengthTier: 'short',  productTier: 'normal',  price: 399 },
      { lengthTier: 'short',  productTier: 'premium', price: 599 },
      { lengthTier: 'medium', productTier: 'normal',  price: 499 },
      { lengthTier: 'medium', productTier: 'premium', price: 699 },
      { lengthTier: 'long',   productTier: 'normal',  price: 599 },
      { lengthTier: 'long',   productTier: 'premium', price: 899 }
    ],
    tags: ['haircut', 'beard', 'shave', 'trim', 'men'],
    popularity: 78
  },
  {
    name: "Men's Refreshing Facial & Scrub",
    category: 'Men',
    subcategory: 'Skin & Cleanup',
    description: 'Charcoal cleanups, anti-pollution facials, de-tan treatments, and face bleaching designed specifically for men\'s skin texture.',
    duration: '45 mins',
    basePrice: 599,
    priceTiers: [
      { lengthTier: 'N/A', productTier: 'normal',  price: 599 },
      { lengthTier: 'N/A', productTier: 'premium', price: 999 },
      { lengthTier: 'N/A', productTier: 'luxury',  price: 1499 }
    ],
    tags: ['facial', 'charcoal', 'cleanup', 'men skin'],
    popularity: 33
  },
  {
    name: 'Head, Neck & Shoulder Massage',
    category: 'Men',
    subcategory: 'Relaxation',
    description: 'Stress relief head massage, targeted neck and shoulder tension release, back massage, and refreshing foot massage sessions.',
    duration: '30–60 mins',
    basePrice: 499,
    priceTiers: [
      { lengthTier: 'N/A', productTier: 'normal',  price: 499 },
      { lengthTier: 'N/A', productTier: 'premium', price: 799 }
    ],
    tags: ['massage', 'relaxation', 'head massage', 'stress relief'],
    popularity: 24
  },
  {
    name: "Men's Manicure & Pedicure",
    category: 'Men',
    subcategory: 'Hands & Feet',
    description: 'Classic grooming mani-pedi for men: nail cleaning, cuticle care, exfoliation scrub, and refreshing foot massage.',
    duration: '30–45 mins',
    basePrice: 449,
    priceTiers: [
      { lengthTier: 'N/A', productTier: 'normal',  price: 449 },
      { lengthTier: 'N/A', productTier: 'premium', price: 699 }
    ],
    tags: ['manicure', 'pedicure', 'men', 'grooming'],
    popularity: 18
  },
  // ── UNISEX ─────────────────────────────────────────────────────────────────
  {
    name: 'Pre-Bridal & Groom Packages',
    category: 'Unisex',
    subcategory: 'Bridal & Groom',
    description: 'Complete pre-wedding grooming bundles including full body polishing, facials, hair treatments, and rejuvenating spa rituals.',
    duration: '180+ mins',
    basePrice: 3499,
    priceTiers: [
      { lengthTier: 'N/A', productTier: 'normal',  price: 3499 },
      { lengthTier: 'N/A', productTier: 'premium', price: 5999 },
      { lengthTier: 'N/A', productTier: 'luxury',  price: 9999 }
    ],
    tags: ['bridal', 'groom', 'package', 'wedding', 'pre-bridal'],
    popularity: 47
  },
  {
    name: 'Express Grooming Combos',
    category: 'Unisex',
    subcategory: 'Quick Bundle',
    description: 'Quick service bundles combining Haircut + Beard/Threading + Cleanup for busy professionals. Save 20% vs individual pricing.',
    duration: '45 mins',
    basePrice: 899,
    priceTiers: [
      { lengthTier: 'short',  productTier: 'normal',  price: 899 },
      { lengthTier: 'medium', productTier: 'normal',  price: 1099 },
      { lengthTier: 'long',   productTier: 'normal',  price: 1299 },
      { lengthTier: 'short',  productTier: 'premium', price: 1299 },
      { lengthTier: 'medium', productTier: 'premium', price: 1499 },
      { lengthTier: 'long',   productTier: 'premium', price: 1799 }
    ],
    tags: ['express', 'combo', 'bundle', 'quick', 'grooming'],
    popularity: 52
  },
  {
    name: 'At-Home Full Body Spa & Therapy',
    category: 'Unisex',
    subcategory: 'Wellness',
    description: 'Licensed professional wellness therapies, aroma oil full body massages, and specialized stress-relief treatments from certified therapists.',
    duration: '60–90 mins',
    basePrice: 1299,
    priceTiers: [
      { lengthTier: 'N/A', productTier: 'normal',  price: 1299 },
      { lengthTier: 'N/A', productTier: 'premium', price: 1999 },
      { lengthTier: 'N/A', productTier: 'luxury',  price: 2999 }
    ],
    tags: ['spa', 'wellness', 'massage', 'body therapy', 'aroma'],
    popularity: 36
  }
];

const salons = [
  {
    name: 'Luxe Studio & Spa',
    ownerName: 'Priya Sharma',
    phone: '+91 98765 43210',
    email: 'luxestudio@example.com',
    address: '12, MG Road, Koramangala',
    city: 'Bangalore',
    pincode: '560034',
    specialty: 'Unisex',
    serviceRadius: '5 km',
    status: 'approved',
    rating: 4.9,
    totalReviews: 128,
    description: 'Premium unisex salon offering top-tier styling and wellness services.'
  },
  {
    name: 'Glamour Hub Parlour',
    ownerName: 'Sunita Verma',
    phone: '+91 99887 76543',
    email: 'glamourhub@example.com',
    address: '45, Indiranagar 12th Main',
    city: 'Bangalore',
    pincode: '560038',
    specialty: 'Women Only',
    serviceRadius: '5 km',
    status: 'approved',
    rating: 4.7,
    totalReviews: 94,
    description: 'Specializing in women\'s grooming, bridal packages and skin care.'
  },
  {
    name: 'Modern Edge Barbershop',
    ownerName: 'Arjun Reddy',
    phone: '+91 88776 65432',
    email: 'modernedge@example.com',
    address: '8, HSR Layout Sector 4',
    city: 'Bangalore',
    pincode: '560102',
    specialty: 'Men Only',
    serviceRadius: '10 km',
    status: 'approved',
    rating: 4.8,
    totalReviews: 213,
    description: 'Premier men\'s barbershop with expert barbers and relaxing ambiance.'
  }
];

async function seedData() {
  // Clear existing
  await Service.deleteMany({});
  await Salon.deleteMany({});

  // Insert
  const insertedServices = await Service.insertMany(services);
  const insertedSalons = await Salon.insertMany(salons);

  console.log(`✅ Seeded ${insertedServices.length} services`);
  console.log(`✅ Seeded ${insertedSalons.length} salons`);
  return { services: insertedServices.length, salons: insertedSalons.length };
}

async function runStandaloneSeed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    await seedData();
    console.log('\n🎉 Database seeded successfully!');
    console.log('👉 Run: node server.js  to start the API');
  } catch (err) {
    console.error('❌ Seed error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

if (require.main === module) {
  runStandaloneSeed();
}

module.exports = { seedData, services, salons };

