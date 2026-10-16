// ============================================
//  Bookings Routes — Create, List, Cancel
//  Path: event-booking/backend/routes/bookings.js
// ============================================

const express = require('express');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Event = require('../models/Event');
const User = require('../models/User');
const { protect, userOnly } = require('../middleware/auth');
const {
  sendBookingConfirmation,
  sendBookingCancellation
} = require('../utils/email');
const {
  useSQS,
  queueEmailJob,
  notifyNewBooking,
  notifyBookingCancelled
} = require('../utils/aws');

const router = express.Router();

// ============================================
//  Helper: dispatch confirmation via SQS or direct
// ============================================
async function dispatchBookingEmail(type, booking, user, event) {
  if (useSQS()) {
    return queueEmailJob({
      type,
      to: user.email,
      name: user.name,
      booking: {
        bookingRef: booking.bookingRef,
        seats: booking.seats,
        totalAmount: booking.totalAmount,
        paymentMethod: booking.paymentMethod
      },
      event: {
        title: event.title,
        venue: event.venue,
        date: event.date
      }
    });
  } else if (type === 'BOOKING_CONFIRMATION') {
    const populated = await booking.populate('event');
    const result = await sendBookingConfirmation(user.email, user.name, populated);
    return { sent: !result?.skipped };
  } else if (type === 'BOOKING_CANCELLATION') {
    const populated = await booking.populate('event');
    const result = await sendBookingCancellation(user.email, user.name, populated);
    return { sent: !result?.skipped };
  }
}

// ============================================
//  POST /api/bookings
//  Create a new booking (atomic seat reservation)
//  Body: { eventId, seats, paymentMethod, attendees?, notes? }
// ============================================
router.post('/', protect, userOnly, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { eventId, seats, paymentMethod, attendees, notes } = req.body;

    // ---------- Validate input ----------
    if (!eventId || !seats || !paymentMethod) {
      await session.abortTransaction();
      return res.status(400).json({
        msg: 'eventId, seats, and paymentMethod are required'
      });
    }

    const seatCount = Number(seats);
    if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 10) {
      await session.abortTransaction();
      return res.status(400).json({ msg: 'Seats must be between 1 and 10' });
    }

    const allowedMethods = ['Card', 'UPI', 'NetBanking', 'Wallet'];
    if (!allowedMethods.includes(paymentMethod)) {
      await session.abortTransaction();
      return res.status(400).json({ msg: 'Invalid payment method' });
    }

    // ---------- Fetch event in transaction ----------
    const event = await Event.findById(eventId).session(session);
    if (!event || !event.isActive) {
      await session.abortTransaction();
      return res.status(404).json({ msg: 'Event not found or inactive' });
    }

    if (event.date.getTime() < Date.now()) {
      await session.abortTransaction();
      return res.status(400).json({ msg: 'Cannot book past events' });
    }

    const seatsLeft = event.totalSeats - event.bookedSeats;
    if (seatCount > seatsLeft) {
      await session.abortTransaction();
      return res.status(400).json({
        msg: seatsLeft === 0
          ? 'Event is sold out'
          : `Only ${seatsLeft} seat(s) left`
      });
    }

    // ---------- Create booking ----------
    const [booking] = await Booking.create(
      [
        {
          user: req.user._id,
          event: event._id,
          seats: seatCount,
          pricePerSeat: event.price,
          paymentMethod,
          paymentStatus: 'NotRequired',
          attendees: Array.isArray(attendees) ? attendees : [],
          notes: notes || ''
        }
      ],
      { session }
    );

    // ---------- Atomically reserve seats ----------
    event.bookedSeats += seatCount;
    await event.save({ session });

    await session.commitTransaction();
    session.endSession();

    // ---------- Fire-and-forget notifications ----------
    const user = await User.findById(req.user._id);

    let emailStatus = useSQS() ? 'queued' : 'sent';
    try {
      const delivery = await dispatchBookingEmail('BOOKING_CONFIRMATION', booking, user, event);
      if (!useSQS() && !delivery?.sent) emailStatus = 'unavailable';
    } catch (err) {
      emailStatus = 'unavailable';
      console.error('booking confirmation email failed:', err.message);
    }

    notifyNewBooking(booking, user, event).catch(err =>
      console.error('booking SNS notification failed:', err.message)
    );

    res.status(201).json({
      msg: emailStatus === 'unavailable'
        ? 'Booking confirmed, but email could not be queued. Save your booking reference and check My Bookings.'
        : emailStatus === 'queued'
          ? 'Booking confirmed. Confirmation email queued for delivery.'
          : 'Booking confirmed. Confirmation email sent.',
      emailStatus,
      booking
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('create booking error:', err.message);
    res.status(500).json({ msg: err.message || 'Server error creating booking' });
  }
});

// ============================================
//  GET /api/bookings/my
//  Current user's bookings
//  Query: ?status=Confirmed|Cancelled
// ============================================
router.get('/my', protect, userOnly, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { user: req.user._id };
    if (status && ['Confirmed', 'Cancelled', 'Attended', 'NoShow'].includes(status)) {
      filter.status = status;
    }

    const bookings = await Booking.find(filter)
      .populate('event', 'title image venue date time price category')
      .sort({ createdAt: -1 });

    // Split into upcoming / past
    const now = Date.now();
    const upcoming = bookings.filter(
      b => b.event && b.event.date && b.event.date.getTime() >= now
    );
    const past = bookings.filter(
      b => !b.event || !b.event.date || b.event.date.getTime() < now
    );

    res.json({ all: bookings, upcoming, past });
  } catch (err) {
    console.error('my bookings error:', err.message);
    res.status(500).json({ msg: 'Server error fetching bookings' });
  }
});

// ============================================
//  GET /api/bookings/:id
//  Single booking (only owner or admin)
// ============================================
router.get('/:id', protect, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('event')
      .populate('user', 'name email');

    if (!booking) return res.status(404).json({ msg: 'Booking not found' });

    const isOwner = booking.user._id.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ msg: 'Not authorized to view this booking' });
    }

    res.json(booking);
  } catch (err) {
    console.error('get booking error:', err.message);
    res.status(500).json({ msg: 'Server error fetching booking' });
  }
});

// ============================================
//  PUT /api/bookings/cancel/:id
//  Cancel booking + release seats + refund flag
// ============================================
router.put('/cancel/:id', protect, userOnly, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await Booking.findById(req.params.id).session(session);
    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ msg: 'Booking not found' });
    }

    if (booking.user.toString() !== req.user._id.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({ msg: 'Not authorized to cancel this booking' });
    }

    if (booking.status === 'Cancelled') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ msg: 'Booking is already cancelled' });
    }

    const event = await Event.findById(booking.event).session(session);
    if (event) {
      // Only allow cancel before event date
      if (event.date.getTime() < Date.now()) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          msg: 'Cannot cancel a booking after the event has started'
        });
      }
      event.bookedSeats = Math.max(0, event.bookedSeats - booking.seats);
      await event.save({ session });
    }

    booking.status = 'Cancelled';
    booking.paymentStatus = booking.paymentStatus === 'Paid' ? 'Refunded' : 'NotRequired';
    booking.cancelledAt = new Date();
    booking.cancellationReason = req.body.reason || 'Cancelled by user';
    await booking.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Fire-and-forget notification
    const user = await User.findById(req.user._id);
    let emailStatus = useSQS() ? 'queued' : 'sent';
    try {
      const delivery = await dispatchBookingEmail('BOOKING_CANCELLATION', booking, user, event);
      if (!useSQS() && !delivery?.sent) emailStatus = 'unavailable';
    } catch (err) {
      emailStatus = 'unavailable';
      console.error('cancellation email failed:', err.message);
    }
    notifyBookingCancelled(booking, user).catch(err =>
      console.error('cancellation SNS notification failed:', err.message)
    );

    res.json({
      msg: emailStatus === 'unavailable'
        ? 'Booking cancelled, but the email could not be queued. Check My Bookings for the updated status.'
        : emailStatus === 'queued'
          ? 'Booking cancelled. Confirmation email queued for delivery.'
          : 'Booking cancelled successfully.',
      emailStatus,
      booking
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('cancel booking error:', err.message);
    res.status(500).json({ msg: err.message || 'Server error cancelling booking' });
  }
});

// ============================================
//  GET /api/bookings/stats/me
//  User's personal stats (dashboard cards)
// ============================================
router.get('/stats/me', protect, userOnly, async (req, res) => {
  try {
    const agg = await Booking.aggregate([
      { $match: { user: req.user._id } },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          confirmed: {
            $sum: { $cond: [{ $eq: ['$status', 'Confirmed'] }, 1, 0] }
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] }
          },
          totalSpent: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'Confirmed'] },
                    { $eq: ['$paymentStatus', 'Paid'] }
                  ]
                },
                '$totalAmount',
                0
              ]
            }
          },
          totalSeats: {
            $sum: {
              $cond: [{ $eq: ['$status', 'Confirmed'] }, '$seats', 0]
            }
          }
        }
      }
    ]);

    const stats = agg[0] || {
      totalBookings: 0,
      confirmed: 0,
      cancelled: 0,
      totalSpent: 0,
      totalSeats: 0
    };
    delete stats._id;

    res.json(stats);
  } catch (err) {
    console.error('user stats error:', err.message);
    res.status(500).json({ msg: 'Server error fetching stats' });
  }
});

module.exports = router;