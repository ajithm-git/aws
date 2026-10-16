// ============================================
//  Events Routes — Public list + Admin CRUD
//  Path: event-booking/backend/routes/events.js
// ============================================

const express = require('express');
const Event = require('../models/Event');
const Booking = require('../models/Booking');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// ============================================
//  GET /api/events
//  Public: list all active events
//  Query params:
//    ?category=Concert
//    ?search=arijit
//    ?city=Mumbai
//    ?featured=true
//    ?upcoming=true
//    ?sort=date|price|-price|newest
//    ?page=1&limit=12
// ============================================
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      category,
      search,
      city,
      featured,
      upcoming,
      sort = 'date',
      page = 1,
      limit = 12
    } = req.query;

    const filter = { isActive: true };

    if (category && category !== 'All') filter.category = category;
    if (city) filter.city = new RegExp(city, 'i');
    if (featured === 'true') filter.isFeatured = true;
    if (upcoming === 'true') filter.date = { $gte: new Date() };

    if (search) {
      filter.$or = [
        { title: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { venue: new RegExp(search, 'i') },
        { tags: new RegExp(search, 'i') }
      ];
    }

    const sortMap = {
      date: { date: 1 },
      '-date': { date: -1 },
      price: { price: 1 },
      '-price': { price: -1 },
      newest: { createdAt: -1 }
    };
    const sortBy = sortMap[sort] || sortMap.date;

    const skip = (Math.max(1, +page) - 1) * Math.max(1, +limit);

    const [events, total] = await Promise.all([
      Event.find(filter).sort(sortBy).skip(skip).limit(+limit),
      Event.countDocuments(filter)
    ]);

    res.json({
      events,
      total,
      page: +page,
      pages: Math.ceil(total / +limit) || 1
    });
  } catch (err) {
    console.error('list events error:', err.message);
    res.status(500).json({ msg: 'Server error fetching events' });
  }
});

// ============================================
//  GET /api/events/featured
//  Public: featured events for hero carousel
// ============================================
router.get('/featured', async (req, res) => {
  try {
    let events = await Event.find({
      isActive: true,
      isFeatured: true,
      date: { $gte: new Date() }
    })
      .sort({ date: 1 })
      .limit(5);

    // Fallback: if no featured flags, pick next 5 upcoming
    if (events.length === 0) {
      events = await Event.find({
        isActive: true,
        date: { $gte: new Date() }
      })
        .sort({ date: 1 })
        .limit(5);
    }

    res.json(events);
  } catch (err) {
    console.error('featured error:', err.message);
    res.status(500).json({ msg: 'Server error fetching featured events' });
  }
});

// ============================================
//  GET /api/events/categories
//  Public: list categories with counts
// ============================================
router.get('/categories', async (req, res) => {
  try {
    const agg = await Event.aggregate([
      { $match: { isActive: true, date: { $gte: new Date() } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    res.json(agg.map(a => ({ category: a._id, count: a.count })));
  } catch (err) {
    res.status(500).json({ msg: 'Server error fetching categories' });
  }
});

// ============================================
//  GET /api/events/:id
//  Public: single event detail
// ============================================
router.get('/:id', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event || !event.isActive) {
      return res.status(404).json({ msg: 'Event not found' });
    }

    // Also return recent bookings count (helps UI show "X people going")
    const bookingsCount = await Booking.countDocuments({
      event: event._id,
      status: 'Confirmed'
    });

    res.json({ ...event.toJSON(), bookingsCount });
  } catch (err) {
    console.error('event detail error:', err.message);
    res.status(500).json({ msg: 'Server error fetching event' });
  }
});

// ============================================
//  POST /api/events   (admin only)
//  Create new event
// ============================================
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      image,
      gallery,
      venue,
      city,
      date,
      time,
      duration,
      price,
      totalSeats,
      tags,
      isFeatured
    } = req.body;

    if (!title || !image || !venue || !date || price == null || !totalSeats) {
      return res.status(400).json({
        msg: 'Title, image, venue, date, price, and totalSeats are required'
      });
    }

    const event = new Event({
      title,
      description,
      category,
      image,
      gallery,
      venue,
      city,
      date: new Date(date),
      time,
      duration,
      price: Number(price),
      totalSeats: Number(totalSeats),
      tags,
      isFeatured: !!isFeatured,
      createdBy: req.user._id
    });

    await event.save();
    res.status(201).json({ msg: 'Event created successfully', event });
  } catch (err) {
    console.error('create event error:', err.message);
    res.status(400).json({ msg: err.message || 'Invalid event data' });
  }
});

// ============================================
//  PUT /api/events/:id   (admin only)
//  Update event
// ============================================
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ msg: 'Event not found' });

    const editable = [
      'title',
      'description',
      'category',
      'image',
      'gallery',
      'venue',
      'city',
      'date',
      'time',
      'duration',
      'price',
      'totalSeats',
      'tags',
      'isFeatured',
      'isActive'
    ];

    for (const key of editable) {
      if (req.body[key] !== undefined) {
        event[key] = key === 'date' ? new Date(req.body[key]) : req.body[key];
      }
    }

    if (event.bookedSeats > event.totalSeats) {
      return res.status(400).json({
        msg: 'totalSeats cannot be less than already-booked seats'
      });
    }

    await event.save();
    res.json({ msg: 'Event updated successfully', event });
  } catch (err) {
    console.error('update event error:', err.message);
    res.status(400).json({ msg: err.message || 'Invalid event data' });
  }
});

// ============================================
//  DELETE /api/events/:id   (admin only)
//  Soft delete — marks as isActive=false
//  Hard delete only if no confirmed bookings
// ============================================
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ msg: 'Event not found' });

    const confirmedBookings = await Booking.countDocuments({
      event: event._id,
      status: 'Confirmed'
    });

    if (confirmedBookings > 0) {
      event.isActive = false;
      await event.save();
      return res.json({
        msg: `Event deactivated (${confirmedBookings} confirmed booking(s) preserved)`
      });
    }

    await Event.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Event deleted permanently' });
  } catch (err) {
    console.error('delete event error:', err.message);
    res.status(500).json({ msg: 'Server error deleting event' });
  }
});

module.exports = router;