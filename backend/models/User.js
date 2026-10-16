// ============================================
//  User Model — Schema + Hooks
//  Path: event-booking/backend/models/User.js
// ============================================

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { randomInt } = require('crypto');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [60, 'Name cannot exceed 60 characters']
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email']
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false // never returned by default queries
    },

    phone: {
      type: String,
      trim: true,
      default: ''
    },

    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user'
    },

    isVerified: {
      type: Boolean,
      default: false
    },

    // ---------- OTP fields (used for register + reset) ----------
    otp: {
      type: String,
      select: false
    },
    otpExpiry: {
      type: Date,
      select: false
    },
    otpPurpose: {
      type: String,
      enum: ['REGISTER', 'RESET', null],
      default: null,
      select: false
    },

    // ---------- Password reset link (optional alternative to OTP) ----------
    resetToken: {
      type: String,
      select: false
    },
    resetTokenExpiry: {
      type: Date,
      select: false
    },

    // ---------- Profile extras ----------
    avatar: {
      type: String,
      default: ''
    },
    lastLogin: {
      type: Date
    }
  },
  {
    timestamps: true, // adds createdAt + updatedAt
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.password;
        delete ret.otp;
        delete ret.otpExpiry;
        delete ret.otpPurpose;
        delete ret.resetToken;
        delete ret.resetTokenExpiry;
        delete ret.__v;
        return ret;
      }
    }
  }
);

// ---------- Indexes ----------
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1 });

// ---------- Virtual: initials ----------
userSchema.virtual('initials').get(function () {
  if (!this.name) return '';
  return this.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
});

// ---------- Instance Method: compare password ----------
userSchema.methods.matchPassword = async function (entered) {
  return bcrypt.compare(entered, this.password);
};

// ---------- Instance Method: generate OTP ----------
userSchema.methods.generateOTP = function (purpose = 'REGISTER', ttlMinutes = 10) {
  const otp = randomInt(100000, 1000000).toString();
  this.otp = otp;
  this.otpPurpose = purpose;
  this.otpExpiry = new Date(Date.now() + ttlMinutes * 60 * 1000);
  return otp;
};

// ---------- Instance Method: clear OTP ----------
userSchema.methods.clearOTP = function () {
  this.otp = undefined;
  this.otpExpiry = undefined;
  this.otpPurpose = undefined;
};

// ---------- Pre-save Hook: hash password if modified ----------
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// ---------- Static: find by email including sensitive fields ----------
userSchema.statics.findByEmailWithAuth = function (email) {
  return this.findOne({ email: email.toLowerCase() }).select(
    '+password +otp +otpExpiry +otpPurpose'
  );
};

module.exports = mongoose.model('User', userSchema);