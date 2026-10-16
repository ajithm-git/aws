// ============================================
//  Email Utility — Nodemailer + HTML Templates
//  Path: event-booking/backend/utils/email.js
// ============================================

const nodemailer = require('nodemailer');

// ---------- Transporter (local SMTP fallback) ----------
const transporter = process.env.USE_SQS_QUEUE === 'true'
  ? null
  : nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ---------- Verify local SMTP connection on boot ----------
if (transporter) transporter.verify((err) => {
  if (err) {
    console.error('❌ Email transporter error:', err.message);
    console.error('   → Check EMAIL_USER / EMAIL_PASS in .env (use Gmail App Password)');
  } else {
    console.log('✅ Email transporter ready (Gmail SMTP)');
  }
});

// ============================================
//  Base Layout Wrapper (dark premium theme)
// ============================================
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function baseLayout({ title, bodyHTML, accentColor = '#a855f7' }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f5fa;font-family:'Segoe UI',Arial,sans-serif;color:#1e2433;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#fbfcff,#f0f2fa,#f7f6ff);padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e4e8f0;border-radius:20px;">
          <!-- Header -->
          <tr>
            <td style="padding:28px 28px 12px 28px;text-align:center;border-bottom:1px solid #e9ecf3;">
              <div style="font-size:26px;font-weight:800;letter-spacing:1px;background:linear-gradient(135deg,${accentColor},#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                🎫 EventBook
              </div>
              <div style="color:#687286;font-size:12px;margin-top:4px;">Event discovery and reservations</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:28px;">
              ${bodyHTML}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:18px 28px 24px 28px;text-align:center;border-top:1px solid #e9ecf3;color:#687286;font-size:11px;line-height:1.6;">
              This is an automated message — please do not reply.<br>
              © ${new Date().getFullYear()} EventBook. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ============================================
//  Reusable UI pieces
// ============================================
function otpBox(otp) {
  return `
  <div style="text-align:center;margin:24px 0;">
    <div style="display:inline-block;padding:16px 32px;border-radius:14px;background:#f0edff;border:1px dashed #9a8de8;">
      <div style="font-size:34px;font-weight:800;letter-spacing:10px;color:#5746d2;font-family:'Courier New',monospace;">
        ${escapeHtml(otp)}
      </div>
    </div>
    <p style="color:#687286;font-size:12px;margin-top:10px;">Valid for 10 minutes</p>
  </div>`;
}

function button(href, label) {
  return `
  <div style="text-align:center;margin:22px 0;">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 32px;border-radius:12px;background:linear-gradient(135deg,#6d5ce7,#4052bd);color:#fff;font-weight:700;text-decoration:none;font-size:14px;">
      ${escapeHtml(label)}
    </a>
  </div>`;
}

// ============================================
//  Template: OTP for REGISTER
// ============================================
function templateRegisterOTP(name, otp) {
  return {
    subject: '🎫 Verify your EventBook account — OTP Inside',
    html: baseLayout({
      title: 'Verify Email',
      bodyHTML: `
        <h2 style="margin:0 0 8px 0;font-size:22px;color:#1e2433;">Hi ${escapeHtml(name)}, welcome! 👋</h2>
        <p style="color:#41495a;font-size:14px;line-height:1.6;margin:0 0 8px 0;">
          Thanks for signing up with EventBook. Use the OTP below to verify your email address:
        </p>
        ${otpBox(otp)}
        <p style="color:#687286;font-size:12px;text-align:center;margin:0;">
          If you didn't create an account, you can safely ignore this email.
        </p>`
    })
  };
}

// ============================================
//  Template: OTP for RESET
// ============================================
function templateResetOTP(name, otp) {
  return {
    subject: '🔐 Reset your EventBook password — OTP Inside',
    html: baseLayout({
      title: 'Reset Password',
      accentColor: '#ef4444',
      bodyHTML: `
        <h2 style="margin:0 0 8px 0;font-size:22px;color:#1e2433;">Password reset requested</h2>
        <p style="color:#41495a;font-size:14px;line-height:1.6;margin:0 0 8px 0;">
          Hi <b>${escapeHtml(name)}</b>, we received a request to reset your password. Enter the OTP below to continue:
        </p>
        ${otpBox(otp)}
        <p style="color:#687286;font-size:12px;text-align:center;margin:0;">
          If this wasn't you, please secure your account immediately.
        </p>`
    })
  };
}

// ============================================
//  Template: Welcome email (post-verification)
// ============================================
function templateWelcome(name) {
  return {
    subject: '🎉 Welcome to EventBook — Your account is verified!',
    html: baseLayout({
      title: 'Welcome',
      bodyHTML: `
        <h2 style="margin:0 0 8px 0;font-size:22px;color:#1e2433;">You're all set, ${escapeHtml(name)}! 🎉</h2>
        <p style="color:#41495a;font-size:14px;line-height:1.6;">
          Your email is verified and your EventBook account is ready. Start exploring amazing events around you:
        </p>
        ${button(process.env.FRONTEND_URL || 'http://localhost:5500', 'Browse Events →')}
        <p style="color:#687286;font-size:12px;text-align:center;">
          Concerts • Conferences • Sports • Workshops — all in one place.
        </p>`
    })
  };
}

// ============================================
//  Template: Booking Confirmation
// ============================================
function templateBookingConfirmation(name, booking) {
  const event = booking.event || {};
  const eventDate = event.date ? new Date(event.date) : null;
  const dateStr = eventDate && !Number.isNaN(eventDate.getTime())
    ? eventDate.toLocaleString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'TBA';

  const title = event.title || 'Your Event';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5500';

  return {
    subject: `🎟️ Booking Confirmed — ${String(title).replace(/[\r\n]+/g, ' ').slice(0, 150)}`,
    html: baseLayout({
      title: 'Booking Confirmed',
      accentColor: '#10b981',
      bodyHTML: `
        <h2 style="margin:0 0 8px 0;font-size:22px;color:#1e2433;">Booking Confirmed! 🎟️</h2>
        <p style="color:#41495a;font-size:14px;line-height:1.6;">
          Hi <b>${escapeHtml(name)}</b>, your booking is confirmed. Details below:
        </p>

        <div style="margin:20px 0;padding:18px;border-radius:14px;background:#f7f8fc;border:1px solid #e4e8f0;">
          <div style="font-size:12px;color:#687286;text-transform:uppercase;letter-spacing:1px;">Booking Ref</div>
          <div style="font-size:20px;font-weight:800;color:#5746d2;font-family:'Courier New',monospace;margin-bottom:14px;">
            ${escapeHtml(booking.bookingRef)}
          </div>

          <table width="100%" style="font-size:13px;color:#41495a;">
            <tr><td style="padding:4px 0;color:#687286;">🎫 Event</td><td align="right"><b>${escapeHtml(event.title || 'N/A')}</b></td></tr>
            <tr><td style="padding:4px 0;color:#687286;">📍 Venue</td><td align="right">${escapeHtml(event.venue || 'N/A')}</td></tr>
            <tr><td style="padding:4px 0;color:#687286;">📅 Date</td><td align="right">${escapeHtml(dateStr)}</td></tr>
            <tr><td style="padding:4px 0;color:#687286;">💺 Seats</td><td align="right">${escapeHtml(booking.seats)}</td></tr>
            <tr><td style="padding:4px 0;color:#687286;">💳 Method</td><td align="right">${escapeHtml(booking.paymentMethod)}</td></tr>
            <tr><td style="padding:8px 0 0 0;color:#687286;border-top:1px solid #e4e8f0;">💰 Total</td>
              <td align="right" style="padding-top:8px;border-top:1px solid #e4e8f0;font-size:16px;font-weight:800;color:#155d40;">
                ₹${escapeHtml(booking.totalAmount)}
              </td>
            </tr>
          </table>
        </div>

        ${button(`${frontendUrl}/dashboard.html`, 'View in Dashboard →')}
        <p style="color:#687286;font-size:12px;text-align:center;">
          Please carry a valid ID matching the booking name at the venue.
        </p>`
    })
  };
}

// ============================================
//  Template: Cancellation
// ============================================
function templateBookingCancellation(name, booking) {
  const event = booking.event || {};
  const title = event.title || 'Your Event';
  return {
    subject: `❌ Booking Cancelled — ${String(title).replace(/[\r\n]+/g, ' ').slice(0, 150)}`,
    html: baseLayout({
      title: 'Booking Cancelled',
      accentColor: '#ef4444',
      bodyHTML: `
        <h2 style="margin:0 0 8px 0;font-size:22px;color:#1e2433;">Booking Cancelled</h2>
        <p style="color:#41495a;font-size:14px;line-height:1.6;">
          Hi <b>${escapeHtml(name)}</b>, your booking <b>${escapeHtml(booking.bookingRef)}</b> for
          <b>${escapeHtml(event.title || 'the event')}</b> has been cancelled.
        </p>
        <p style="color:#41495a;font-size:14px;line-height:1.6;">
          This demo reservation flow does not process payments, so no refund is due.
        </p>
        ${button(process.env.FRONTEND_URL || 'http://localhost:5500', 'Explore More Events →')}`
    })
  };
}

// ============================================
//  Core Sender
// ============================================
async function sendEmail({ to, subject, html }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠️  Email skipped — EMAIL_USER/EMAIL_PASS not set');
    return { skipped: true };
  }
  const info = await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'EventBook'}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
  });
  return info;
}

// ============================================
//  High-level helpers (used by routes)
// ============================================
async function sendOTP(to, otp, purpose, name = 'User') {
  const tpl =
    purpose === 'REGISTER'
      ? templateRegisterOTP(name, otp)
      : templateResetOTP(name, otp);
  return sendEmail({ to, ...tpl });
}

async function sendWelcome(to, name) {
  return sendEmail({ to, ...templateWelcome(name) });
}

async function sendBookingConfirmation(to, name, booking) {
  return sendEmail({ to, ...templateBookingConfirmation(name, booking) });
}

async function sendBookingCancellation(to, name, booking) {
  return sendEmail({ to, ...templateBookingCancellation(name, booking) });
}

module.exports = {
  transporter,
  sendEmail,
  sendOTP,
  sendWelcome,
  sendBookingConfirmation,
  sendBookingCancellation
};