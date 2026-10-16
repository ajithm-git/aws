// ============================================
//  Booking Model — Schema + Hooks
//  Path: event-booking/backend/models/Booking.js
// ============================================

const mongoose = require('mongoose');
const { randomInt } = require('crypto');

// Generate a human-friendly booking reference (e.g., "EB-7K2X9P4A")
function generateBookingRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I for clarity
  let ref = 'EB-';
  for (let i = 0; i < 8; i++) {
    ref += chars.charAt(randomInt(chars.length));
  }
  return ref;
}

const bookingSchema = new mongoose.Schema(
  {
    bookingRef: {
      type: String,
      unique: true,
      index: true,
      default: generateBookingRef
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User is required'],
      index: true
    },

    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: [true, 'Event is required'],
      index: true
    },

    seats: {
      type: Number,
      required: [true, 'Seat count is required'],
      min: [1, 'At least 1 seat required'],
      max: [10, 'Maximum 10 seats per booking']
    },

    // Snapshot of price at time of booking (in case event price changes later)
    pricePerSeat: {
      type: Number,
      required: true,
      min: 0
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0
    },

    paymentMethod: {
      type: String,
      enum: {
        values: ['Card', 'UPI', 'NetBanking', 'Wallet'],
        message: '{VALUE} is not a supported payment method'
      },
      required: [true, 'Payment method is required']
    },

    paymentStatus: {
      type: String,
      enum: ['Paid', 'Pending', 'Failed', 'Refunded', 'NotRequired'],
      default: 'NotRequired'
    },

    // Fake transaction id (simulates payment gateway)
    transactionId: {
      type: String,
      default: () => 'TXN-' + Date.now() + '-' + Math.floor(Math.random() * 10000)
    },

    status: {
      type: String,
      enum: ['Confirmed', 'Cancelled', 'Attended', 'NoShow'],
      default: 'Confirmed'
    },

    // ---------- Optional: attendee info (for multi-seat) ----------
    attendees: [
      {
        name: { type: String, trim: true },
        email: { type: String, trim: true, lowercase: true },
        phone: { type: String, trim: true }
      }
    ],

    notes: {
      type: String,
      trim: true,
      maxlength: 500,
      default: ''
    },

    cancelledAt: {
      type: Date
    },

    cancellationReason: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      }
    }
  }
);

// ---------- Compound Indexes ----------
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ event: 1, status: 1 });
bookingSchema.index({ status: 1, createdAt: -1 });

// ---------- Virtual: isCancellable ----------
bookingSchema.virtual('isCancellable').get(function () {
  if (this.status !== 'Confirmed') return false;
  // Only cancellable if event is still in the future
  if (this.event && this.event.date) {
    return this.event.date.getTime() > Date.now();
  }
  return true;
});

// ---------- Virtual: statusColor (for UI) ----------
bookingSchema.virtual('statusColor').get(function () {
  switch (this.status) {
    case 'Confirmed':
      return 'green';
    case 'Cancelled':
      return 'red';
    case 'Attended':
      return 'blue';
    case 'NoShow':
      return 'gray';
    default:
      return 'gray';
  }
});

// ---------- Instance Method: cancel ----------
bookingSchema.methods.cancel = function (reason = '') {
  if (this.status === 'Cancelled') {
    throw new Error('Booking is already cancelled');
  }
  this.status = 'Cancelled';
  this.paymentStatus = this.paymentStatus === 'Paid' ? 'Refunded' : 'NotRequired';
  this.cancelledAt = new Date();
  this.cancellationReason = reason;
  return this.save();
};

// ---------- Pre-save Hook: compute totalAmount ----------
bookingSchema.pre('save', function (next) {
  if (this.isModified('seats') || this.isModified('pricePerSeat')) {
    this.totalAmount = this.seats * this.pricePerSeat;
  }
  next();
});

// ---------- Pre-validate Hook: ensure bookingRef uniqueness format ----------
bookingSchema.pre('validate', function (next) {
  if (!this.bookingRef || !/^EB-[A-Z0-9]{8}$/.test(this.bookingRef)) {
    this.bookingRef = generateBookingRef();
  }
  next();
});

module.exports = mongoose.model('Booking', bookingSchema);