// ============================================
//  Auth Routes — Register, Verify, Login, Reset
//  Path: event-booking/backend/routes/auth.js
// ============================================

const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect, signToken } = require('../middleware/auth');
const { readSecret } = require('../config/secrets');
const {
  sendOTP,
  sendWelcome
} = require('../utils/email');
const {
  useSQS,
  queueEmailJob,
  notifyNewUser
} = require('../utils/aws');

const router = express.Router();

// ============================================
//  Helper: Dispatch OTP via SQS or direct email
// ============================================
async function dispatchOTP(user, otp, purpose) {
  if (useSQS()) {
    return queueEmailJob({
      type: 'OTP',
      to: user.email,
      name: user.name,
      otp,
      purpose
    });
  } else {
    return sendOTP(user.email, otp, purpose, user.name);
  }
}

async function dispatchWelcome(user) {
  if (useSQS()) {
    await queueEmailJob({
      type: 'WELCOME',
      to: user.email,
      name: user.name
    });
  } else {
    await sendWelcome(user.email, user.name);
  }
}

// ============================================
//  POST /api/auth/register
//  Register → generate OTP → email it
// ============================================
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ msg: 'Name, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ msg: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing && existing.isVerified) {
      return res.status(400).json({ msg: 'Email already registered. Please login.' });
    }

    // If user exists but not verified → reuse record (fresh OTP)
    let user;
    if (existing && !existing.isVerified) {
      existing.name = name;
      existing.password = password; // hashed by pre-save hook
      existing.phone = phone || existing.phone;
      user = existing;
    } else {
      user = new User({ name, email, password, phone });
    }

    const otp = user.generateOTP('REGISTER', 10);
    await user.save();

    const delivery = await dispatchOTP(user, otp, 'REGISTER');

    res.json({
      msg: delivery?.skipped
        ? 'Registration saved, but email is not configured. Contact the administrator.'
        : useSQS()
          ? 'Registration successful. Verification code queued for delivery.'
          : 'Registration successful. Verification code sent to your email.',
      email: user.email
    });
  } catch (err) {
    console.error('register error:', err.message);
    res.status(500).json({ msg: 'Server error during registration' });
  }
});

// ============================================
//  POST /api/auth/verify-otp
//  Registration OTP verification
// ============================================
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ msg: 'Email and OTP are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+otp +otpExpiry +otpPurpose');

    if (!user) return res.status(400).json({ msg: 'User not found' });
    if (user.isVerified) return res.status(400).json({ msg: 'Email already verified' });

    if (
      user.otp !== otp ||
      user.otpPurpose !== 'REGISTER' ||
      !user.otpExpiry ||
      user.otpExpiry.getTime() < Date.now()
    ) {
      return res.status(400).json({ msg: 'Invalid or expired OTP' });
    }

    user.isVerified = true;
    user.clearOTP();
    await user.save();

    // Send welcome email (fire-and-forget)
    dispatchWelcome(user).catch(err =>
      console.warn('welcome email failed:', err.message)
    );
    notifyNewUser(user).catch(err =>
      console.error('registration SNS notification failed:', err.message)
    );

    res.json({ msg: 'Email verified successfully! You can now login.' });
  } catch (err) {
    console.error('verify-otp error:', err.message);
    res.status(500).json({ msg: 'Server error during verification' });
  }
});

// ============================================
//  POST /api/auth/resend-otp
//  Resend OTP (for register or reset)
// ============================================
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ msg: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(400).json({ msg: 'User not found' });

    const purpose = user.isVerified ? 'RESET' : 'REGISTER';
    const otp = user.generateOTP(purpose, 10);
    await user.save();

    const delivery = await dispatchOTP(user, otp, purpose);

    res.json({
      msg: delivery?.skipped
        ? 'Email is not configured. Contact the administrator.'
        : useSQS()
          ? 'A new code has been queued for delivery.'
          : 'A new OTP has been sent to your email.'
    });
  } catch (err) {
    console.error('resend-otp error:', err.message);
    res.status(500).json({ msg: 'Server error while resending OTP' });
  }
});

// ============================================
//  POST /api/auth/login
//  User login (blocks admins — they use /admin-login)
// ============================================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ msg: 'Email and password required' });
    }

    const user = await User.findByEmailWithAuth(email);
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

    if (!user.isVerified) {
      return res.status(400).json({
        msg: 'Please verify your email first. Check your inbox for the OTP.'
      });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ msg: 'Please use the admin login page' });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = signToken(user._id, { role: user.role });

    res.json({
      msg: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        initials: user.initials
      }
    });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ msg: 'Server error during login' });
  }
});

// ============================================
//  POST /api/auth/admin-login
//  Admin login (auto-creates admin from .env on first use)
// ============================================
router.post('/admin-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ msg: 'Email and password required' });
    }

    let admin = await User.findOne({
      email: email.toLowerCase(),
      role: 'admin'
    }).select('+password');

    let adminEmail = process.env.ADMIN_EMAIL || '';
    let adminPassword = process.env.ADMIN_PASSWORD || '';
    if (process.env.APP_SECRET_ARN) {
      const adminSecrets = await readSecret(process.env.APP_SECRET_ARN, { refresh: true });
      adminEmail = adminSecrets.adminEmail || '';
      adminPassword = adminSecrets.adminPassword || '';
    }

    const matchesManagedCredentials =
      email.toLowerCase() === adminEmail.toLowerCase() &&
      password === adminPassword;

    if (matchesManagedCredentials) {
      if (!admin) {
        admin = await User.findOne({ role: 'admin' }).select('+password');
      }
      if (!admin) {
        admin = new User({
          name: 'EventBook Admin',
          email: email.toLowerCase(),
          password,
          role: 'admin',
          isVerified: true
        });
        await admin.save();
      } else {
        const passwordMatches = await admin.matchPassword(password);
        if (admin.email !== email.toLowerCase() || !passwordMatches) {
          admin.email = email.toLowerCase();
          admin.password = password;
          admin.isVerified = true;
          await admin.save();
        }
      }
    }

    if (!admin || admin.role !== 'admin') {
      return res.status(400).json({ msg: 'Invalid admin credentials' });
    }

    const isMatch = await admin.matchPassword(password);
    if (!isMatch) {
      return res.status(400).json({ msg: 'Invalid admin credentials' });
    }

    admin.lastLogin = new Date();
    await admin.save();

    const token = signToken(admin._id, { role: 'admin' });

    res.json({
      msg: 'Admin login successful',
      token,
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: 'admin'
      }
    });
  } catch (err) {
    console.error('admin-login error:', err.message);
    res.status(500).json({ msg: 'Server error during admin login' });
  }
});

// ============================================
//  POST /api/auth/forgot-password
//  Send reset OTP
// ============================================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ msg: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal whether email exists (security best practice)
      return res.json({
        msg: 'If an account exists, a reset OTP has been sent.',
        email: email.toLowerCase()
      });
    }

    const otp = user.generateOTP('RESET', 10);
    await user.save();

    const delivery = await dispatchOTP(user, otp, 'RESET');

    res.json({
      msg: delivery?.skipped
        ? 'Email is not configured. Contact the administrator.'
        : useSQS()
          ? 'Password reset code queued for delivery.'
          : 'Reset OTP sent to your email.',
      email: user.email
    });
  } catch (err) {
    console.error('forgot-password error:', err.message);
    res.status(500).json({ msg: 'Server error while sending reset OTP' });
  }
});

// ============================================
//  POST /api/auth/reset-password
//  Verify RESET OTP → update password
// ============================================
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    if (!email || !otp || !password) {
      return res.status(400).json({ msg: 'Email, OTP, and new password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ msg: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email: email.toLowerCase() })
      .select('+otp +otpExpiry +otpPurpose +password');

    if (!user) return res.status(400).json({ msg: 'User not found' });

    if (
      user.otp !== otp ||
      user.otpPurpose !== 'RESET' ||
      !user.otpExpiry ||
      user.otpExpiry.getTime() < Date.now()
    ) {
      return res.status(400).json({ msg: 'Invalid or expired OTP' });
    }

    user.password = password; // hashed by pre-save hook
    user.clearOTP();
    await user.save();

    res.json({ msg: 'Password reset successful! Please login.' });
  } catch (err) {
    console.error('reset-password error:', err.message);
    res.status(500).json({ msg: 'Server error while resetting password' });
  }
});

// ============================================
//  GET /api/auth/me
//  Return current logged-in user
// ============================================
router.get('/me', protect, async (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      initials: req.user.initials,
      phone: req.user.phone,
      isVerified: req.user.isVerified
    }
  });
});

// ============================================
//  PUT /api/auth/profile
//  Update name / phone
// ============================================
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (name) req.user.name = name;
    if (phone !== undefined) req.user.phone = phone;
    await req.user.save();
    res.json({ msg: 'Profile updated', user: req.user });
  } catch (err) {
    res.status(500).json({ msg: 'Server error updating profile' });
  }
});

module.exports = router;