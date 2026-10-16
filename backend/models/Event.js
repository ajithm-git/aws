// ============================================
//  Event Model — Schema + Hooks
//  Path: event-booking/backend/models/Event.js
// ============================================

const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Event title is required'],
      trim: true,
      minlength: [3, 'Title must be at least 3 characters'],
      maxlength: [120, 'Title cannot exceed 120 characters']
    },

    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
      default: ''
    },

    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true,
      enum: {
        values: [
          'Concert',
          'Conference',
          'Sports',
          'Workshop',
          'Theater',
          'Comedy',
          'Festival',
          'Exhibition',
          'General'
        ],
        message: '{VALUE} is not a supported category'
      },
      default: 'General'
    },

    image: {
      type: String,
      required: [true, 'Image URL is required'],
      trim: true,
      match: [/^https?:\/\/.+/, 'Image must be a valid URL']
    },

    gallery: {
      type: [String],
      default: []
    },

    venue: {
      type: String,
      required: [true, 'Venue is required'],
      trim: true,
      maxlength: [200, 'Venue cannot exceed 200 characters']
    },

    city: {
      type: String,
      trim: true,
      default: ''
    },

    date: {
      type: Date,
      required: [true, 'Event date is required']
    },

    time: {
      type: String,
      trim: true,
      default: 'TBA'
    },

    duration: {
      type: String,
      trim: true,
      default: ''
    },

    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative']
    },

    totalSeats: {
      type: Number,
      required: [true, 'Total seats is required'],
      min: [1, 'There must be at least 1 seat']
    },

    bookedSeats: {
      type: Number,
      default: 0,
      min: 0
    },

    tags: {
      type: [String],
      default: []
    },

    isFeatured: {
      type: Boolean,
      default: false
    },

    isActive: {
      type: Boolean,
      default: true
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
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

// ---------- Indexes ----------
eventSchema.index({ date: 1 });
eventSchema.index({ category: 1 });
eventSchema.index({ isActive: 1, date: 1 });

// ---------- Virtual: seatsLeft ----------
eventSchema.virtual('seatsLeft').get(function () {
  return Math.max(0, this.totalSeats - this.bookedSeats);
});

// ---------- Virtual: isSoldOut ----------
eventSchema.virtual('isSoldOut').get(function () {
  return this.bookedSeats >= this.totalSeats;
});

// ---------- Virtual: isUpcoming ----------
eventSchema.virtual('isUpcoming').get(function () {
  return this.date && this.date.getTime() > Date.now();
});

// ---------- Virtual: formattedDate ----------
eventSchema.virtual('formattedDate').get(function () {
  if (!this.date) return '';
  return this.date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
});

// ---------- Instance Method: reserveSeats ----------
eventSchema.methods.reserveSeats = function (count) {
  if (count < 1) throw new Error('Seat count must be at least 1');
  if (this.bookedSeats + count > this.totalSeats) {
    throw new Error(`Only ${this.seatsLeft} seat(s) available`);
  }
  this.bookedSeats += count;
  return this.save();
};

// ---------- Instance Method: releaseSeats ----------
eventSchema.methods.releaseSeats = function (count) {
  if (count < 1) return this;
  this.bookedSeats = Math.max(0, this.bookedSeats - count);
  return this.save();
};

// ---------- Pre-save Hook: prevent overbooking ----------
eventSchema.pre('save', function (next) {
  if (this.bookedSeats > this.totalSeats) {
    return next(new Error('bookedSeats cannot exceed totalSeats'));
  }
  next();
});

module.exports = mongoose.model('Event', eventSchema);