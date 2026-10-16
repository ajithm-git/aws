// ============================================
//  Auth Middleware — JWT verify + role guards
//  Path: event-booking/backend/middleware/auth.js
// ============================================

const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ---------- Extract Bearer token ----------
function getToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
}

// ---------- Verify JWT ----------
function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// ============================================
//  protect — Requires valid JWT
//  Attaches req.user (without password/otp)
// ============================================
exports.protect = async (req, res, next) => {
  try {
    const token = getToken(req);
    if (!token) {
      return res.status(401).json({ msg: 'No token, access denied' });
    }

    const decoded = verifyToken(token);
    if (!decoded || !decoded.id) {
      return res.status(401).json({ msg: 'Invalid or expired token' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ msg: 'User no longer exists' });
    }

    if (!user.isVerified) {
      return res.status(403).json({ msg: 'Please verify your email first' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('protect error:', err.message);
    res.status(500).json({ msg: 'Auth middleware error' });
  }
};

// ============================================
//  adminOnly — Must be used AFTER protect
// ============================================
exports.adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ msg: 'Not authenticated' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ msg: 'Admin access required' });
  }
  next();
};

// ============================================
//  userOnly — Must be used AFTER protect
//  Rejects admin accounts on user-only routes
// ============================================
exports.userOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ msg: 'Not authenticated' });
  }
  if (req.user.role !== 'user') {
    return res.status(403).json({ msg: 'This route is for regular users only' });
  }
  next();
};

// ============================================
//  optionalAuth — Attaches req.user if token present
//  Never blocks the request (useful for public pages
//  that show "logged-in" state)
// ============================================
exports.optionalAuth = async (req, res, next) => {
  try {
    const token = getToken(req);
    if (!token) return next();

    const decoded = verifyToken(token);
    if (!decoded || !decoded.id) return next();

    const user = await User.findById(decoded.id);
    if (user) req.user = user;
    next();
  } catch {
    next();
  }
};

// ============================================
//  requireVerified — Blocks unverified users
//  Useful after login flow
// ============================================
exports.requireVerified = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ msg: 'Not authenticated' });
  }
  if (!req.user.isVerified) {
    return res.status(403).json({ msg: 'Email verification required' });
  }
  next();
};

// ============================================
//  signToken — Helper to create JWT
//  Usage: const token = signToken(user._id)
// ============================================
exports.signToken = (userId, extra = {}) => {
  return jwt.sign(
    { id: userId, ...extra },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};