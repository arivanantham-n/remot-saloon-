/**
 * Migration 001: Add Role-Based Profile fields to User and Salon schemas
 * Non-destructive, reversible migration with backfill for existing records.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Salon = require('../models/Salon');

async function up() {
  console.log('🚀 Running Migration 001: UP (Adding role-based profile fields)...');

  // 1. Ensure all users have a role (default: 'client')
  const usersWithoutRole = await User.updateMany(
    { $or: [{ role: { $exists: false } }, { role: null }, { role: '' }] },
    { $set: { role: 'client' } }
  );
  console.log(`  ✅ Backfilled role='client' on ${usersWithoutRole.modifiedCount || 0} users.`);

  // 2. Ensure all users have profilePhoto field
  const userPhotos = await User.updateMany(
    { profilePhoto: { $exists: false } },
    { $set: { profilePhoto: '' } }
  );
  console.log(`  ✅ Initialized profilePhoto on ${userPhotos.modifiedCount || 0} users.`);

  // 3. For any Salon without an owner, link or create owner with role 'salon_owner'
  const salons = await Salon.find({});
  let ownersLinked = 0;

  for (const salon of salons) {
    let updateFields = {};
    if (!salon.logo) updateFields.logo = '';
    if (!salon.bio) updateFields.bio = salon.description || '';
    if (!salon.payoutDetails) {
      updateFields.payoutDetails = {
        accountHolderName: salon.ownerName || '',
        accountNumber: '',
        ifscCode: '',
        upiId: ''
      };
    }

    if (!salon.owner && salon.phone) {
      // Find or create salon owner user
      const cleanPhone = salon.phone.trim();
      let ownerUser = await User.findOne({ phone: cleanPhone });
      if (!ownerUser) {
        ownerUser = new User({
          name: salon.ownerName || salon.name,
          phone: cleanPhone,
          email: salon.email || undefined,
          role: 'salon_owner',
          isVerified: true
        });
        await ownerUser.save();
      } else if (ownerUser.role !== 'salon_owner' && ownerUser.role !== 'admin') {
        ownerUser.role = 'salon_owner';
        await ownerUser.save();
      }
      updateFields.owner = ownerUser._id;
      ownersLinked++;
    }

    if (Object.keys(updateFields).length > 0) {
      await Salon.findByIdAndUpdate(salon._id, { $set: updateFields });
    }
  }

  console.log(`  ✅ Linked ${ownersLinked} salon owners and initialized logo, bio, payoutDetails.`);
  console.log('🎉 Migration 001 UP completed successfully.');
  return true;
}

async function down() {
  console.log('⏪ Running Migration 001: DOWN (Reverting profile fields)...');

  // Revert Salon added fields
  await Salon.updateMany({}, {
    $unset: { logo: '', bio: '', payoutDetails: '' }
  });
  console.log('  ✅ Unset logo, bio, payoutDetails on all salons.');

  // Revert User profilePhoto
  await User.updateMany({}, {
    $unset: { profilePhoto: '' }
  });
  console.log('  ✅ Unset profilePhoto on all users.');

  console.log('🎉 Migration 001 DOWN completed successfully.');
  return true;
}

if (require.main === module) {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/glo-salon';
  const action = process.argv[2] || 'up';

  mongoose.connect(MONGODB_URI)
    .then(async () => {
      if (action === 'down') {
        await down();
      } else {
        await up();
      }
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { up, down };
