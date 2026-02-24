import mongoose from 'mongoose';

const verificationTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  farmhouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Farmhouse',
    required: true
  },
  slotId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  label: {
    type: String,
    required: true
  },
  timing: {
    type: String,
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  usedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
verificationTokenSchema.index({ userId: 1, farmhouseId: 1, slotId: 1, date: 1 });

export const VerificationToken = mongoose.model('VerificationToken', verificationTokenSchema);