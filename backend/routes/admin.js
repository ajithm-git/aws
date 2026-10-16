// ============================================
//  Admin Routes — Stats, Users, Bookings
//  Path: event-booking/backend/routes/admin.js
// ============================================

const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Event = require('../models/Event');
const Booking = require('../models/Booking');
const { protect, adminOnly } = require('../middleware/auth');
const { createImageUpload } = require('../utils/aws');

const router = express.Router();

// All admin routes require protect + adminOnly
router.use(protect, adminOnly);

router.post('/uploads/presign', async (req, res) => {
  const { contentType, size } = req.body;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(contentType)) {
    return res.status(400).json({ msg: 'Only JPG, PNG, and WebP images are supported.' });
  }
  if (!Number.isInteger(size) || size < 1 || size > 5 * 1024 * 1024) {
    return res.status(400).json({ msg: 'Image size must be 5 MB or less.' });
  }

  try {
    const upload = await createImageUpload(contentType);
    res.json(upload);
  } catch (err) {
    console.error('image upload signing error:', err.message);
    res.status(503).json({ msg: 'Image upload is temporarily unavailable.' });
  }
});

// ============================================
//  GET /api/admin/stats
//  Dashboard KPIs
// ============================================
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();

    const [
      totalUsers,
      verifiedUsers,
      totalEvents,
      activeEvents,
      upcomingEvents,
      totalBookings,
      confirmedBookings,
      cancelledBookings,
      revenueAgg,
      seatsAgg
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', isVerified: true }),
      Event.countDocuments(),
      Event.countDocuments({ isActive: true }),
      Event.countDocuments({ isActive: true, date: { $gte: now } }),
      Booking.countDocuments(),
      Booking.countDocuments({ status: 'Confirmed' }),
      Booking.countDocuments({ status: 'Cancelled' }),
      Booking.aggregate([
        { $match: { status: 'Confirmed', paymentStatus: 'Paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      Booking.aggregate([
        { $match: { status: 'Confirmed' } },
        { $group: { _id: null, total: { $sum: '$seats' } } }
      ])
    ]);

    res.json({
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        pending: totalUsers - verifiedUsers
      },
      events: {
        total: totalEvents,
        active: activeEvents,
        upcoming: upcomingEvents
      },
      bookings: {
        total: totalBookings,
        confirmed: confirmedBookings,
        cancelled: cancelledBookings
      },
      revenue: revenueAgg[0]?.total || 0,
      seatsSold: seatsAgg[0]?.total || 0
    });
  } catch (err) {
    console.error('admin stats error:', err.message);
    res.status(500).json({ msg: 'Server error fetching stats' });
  }
});

// ============================================
//  GET /api/admin/revenue
//  Revenue chart — last 30 days
// ============================================
router.get('/revenue', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 7), 90);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const agg = await Booking.aggregate([
      {
        $match: {
          status: 'Confirmed',
          paymentStatus: 'Paid',
          createdAt: { $gte: from }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          revenue: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, '$totalAmount', 0]
            }
          },
          bookings: { $sum: 1 },
          seats: { $sum: '$seats' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Fill missing days with zeros
    const map = new Map(agg.map(d => [d._id, d]));
    const result = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const entry = map.get(key);
      result.push({
        date: key,
        revenue: entry?.revenue || 0,
        bookings: entry?.bookings || 0,
        seats: entry?.seats || 0
      });
    }

    const totalRevenue = result.reduce((s, r) => s + r.revenue, 0);
    const totalBookings = result.reduce((s, r) => s + r.bookings, 0);

    res.json({ series: result, totalRevenue, totalBookings, days });
  } catch (err) {
    console.error('revenue error:', err.message);
    res.status(500).json({ msg: 'Server error fetching revenue' });
  }
});

// ============================================
//  GET /api/admin/top-events
//  Best-selling events
// ============================================
router.get('/top-events', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    const agg = await Booking.aggregate([
      { $match: { status: 'Confirmed' } },
      {
        $group: {
          _id: '$event',
          seatsSold: { $sum: '$seats' },
          revenue: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'Paid'] }, '$totalAmount', 0]
            }
          },
          bookings: { $sum: 1 }
        }
      },
      { $sort: { seatsSold: -1, bookings: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: 'events',
          localField: '_id',
          foreignField: '_id',
          as: 'event'
        }
      },
      { $unwind: '$event' },
      {
        $project: {
          _id: 0,
          eventId: '$_id',
          title: '$event.title',
          image: '$event.image',
          venue: '$event.venue',
          date: '$event.date',
          price: '$event.price',
          seatsSold: 1,
          revenue: 1,
          bookings: 1
        }
      }
    ]);

    res.json(agg);
  } catch (err) {
    console.error('top events error:', err.message);
    res.status(500).json({ msg: 'Server error fetching top events' });
  }
});

// ============================================
//  GET /api/admin/users
//  List all regular users (paginated + search)
// ============================================
router.get('/users', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      verified
    } = req.query;

    const filter = { role: 'user' };
    if (search) {
      filter.$or = [
        { name: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') }
      ];
    }
    if (verified === 'true') filter.isVerified = true;
    if (verified === 'false') filter.isVerified = false;

    const skip = (Math.max(1, +page) - 1) * +limit;

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(+limit),
      User.countDocuments(filter)
    ]);

    // Get booking counts for these users
    const userIds = users.map(u => u._id);
    const bookingCounts = await Booking.aggregate([
      { $match: { user: { $in: userIds } } },
      {
        $group: {
          _id: '$user',
          bookings: { $sum: 1 },
          spent: {
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
          }
        }
      }
    ]);
    const countMap = new Map(
      bookingCounts.map(c => [c._id.toString(), c])
    );

    const enriched = users.map(u => ({
      ...u.toJSON(),
      bookings: countMap.get(u._id.toString())?.bookings || 0,
      spent: countMap.get(u._id.toString())?.spent || 0
    }));

    res.json({
      users: enriched,
      total,
      page: +page,
      pages: Math.ceil(total / +limit) || 1
    });
  } catch (err) {
    console.error('admin users error:', err.message);
    res.status(500).json({ msg: 'Server error fetching users' });
  }
});

// ============================================
//  GET /api/admin/users/:id
//  Single user detail with bookings
// ============================================
router.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'user') {
      return res.status(404).json({ msg: 'User not found' });
    }

    const bookings = await Booking.find({ user: user._id })
      .populate('event', 'title venue date price')
      .sort({ createdAt: -1 });

    const spent = bookings
      .filter(b => b.status === 'Confirmed' && b.paymentStatus === 'Paid')
      .reduce((s, b) => s + b.totalAmount, 0);

    res.json({ user, bookings, spent });
  } catch (err) {
    console.error('admin user detail error:', err.message);
    res.status(500).json({ msg: 'Server error fetching user' });
  }
});

// ============================================
//  DELETE /api/admin/users/:id
//  Delete user + all their bookings
// ============================================
router.delete('/users/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(req.params.id).session(session);
    if (!user || user.role !== 'user') {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ msg: 'User not found' });
    }

    // Release reserved seats from confirmed bookings
    const confirmed = await Booking.find({
      user: user._id,
      status: 'Confirmed'
    }).session(session);

    for (const b of confirmed) {
      await Event.findByIdAndUpdate(
        b.event,
        { $inc: { bookedSeats: -b.seats } },
        { session }
      );
    }

    await Booking.deleteMany({ user: user._id }).session(session);
    await User.findByIdAndDelete(user._id).session(session);

    await session.commitTransaction();
    session.endSession();

    res.json({ msg: `User "${user.name}" and their bookings deleted` });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('delete user error:', err.message);
    res.status(500).json({ msg: 'Server error deleting user' });
  }
});

// ============================================
//  GET /api/admin/bookings
//  List all bookings (paginated + filters)
// ============================================
router.get('/bookings', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      search = ''
    } = req.query;

    const filter = {};
    if (status && ['Confirmed', 'Cancelled', 'Attended', 'NoShow'].includes(status)) {
      filter.status = status;
    }
    if (search) {
      filter.bookingRef = new RegExp(search, 'i');
    }

    const skip = (Math.max(1, +page) - 1) * +limit;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('user', 'name email')
        .populate('event', 'title venue date price image')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(+limit),
      Booking.countDocuments(filter)
    ]);

    res.json({
      bookings,
      total,
      page: +page,
      pages: Math.ceil(total / +limit) || 1
    });
  } catch (err) {
    console.error('admin bookings error:', err.message);
    res.status(500).json({ msg: 'Server error fetching bookings' });
  }
});

// ============================================
//  PUT /api/admin/bookings/:id/status
//  Manually update booking status (mark attended etc.)
// ============================================
router.put('/bookings/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['Confirmed', 'Cancelled', 'Attended', 'NoShow'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ msg: 'Invalid status' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ msg: 'Booking not found' });

    booking.status = status;
    await booking.save();

    res.json({ msg: `Booking marked as ${status}`, booking });
  } catch (err) {
    console.error('update booking status error:', err.message);
    res.status(500).json({ msg: 'Server error updating booking' });
  }
});

// ============================================
//  GET /api/admin/recent-activity
//  Recent bookings + new users (feed for dashboard)
// ============================================
router.get('/recent-activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);

    const [recentBookings, recentUsers] = await Promise.all([
      Booking.find()
        .populate('user', 'name email initials')
        .populate('event', 'title')
        .sort({ createdAt: -1 })
        .limit(limit),
      User.find({ role: 'user' })
        .sort({ createdAt: -1 })
        .limit(limit)
    ]);

    const feed = [
      ...recentBookings.map(b => ({
        type: 'booking',
        at: b.createdAt,
        user: b.user?.name || 'Unknown',
        event: b.event?.title || 'Deleted event',
        amount: b.totalAmount,
        seats: b.seats,
        status: b.status
      })),
      ...recentUsers.map(u => ({
        type: 'signup',
        at: u.createdAt,
        user: u.name,
        email: u.email,
        verified: u.isVerified
      }))
    ]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, limit);

    res.json(feed);
  } catch (err) {
    console.error('recent activity error:', err.message);
    res.status(500).json({ msg: 'Server error fetching activity' });
  }
});

module.exports = router;