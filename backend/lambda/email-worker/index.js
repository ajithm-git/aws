const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const ses = new SESv2Client({});

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function buildEmail(job) {
  const name = escapeHtml(job.name || 'there');
  const event = job.event || {};
  const booking = job.booking || {};

  if (job.type === 'OTP') {
    const reset = job.purpose === 'RESET';
    return {
      subject: reset ? 'Reset your EventBook password' : 'Verify your EventBook account',
      text: `Hi ${job.name || ''}, your verification code is ${job.otp}. It expires in 10 minutes.`,
      html: `<h2>${reset ? 'Password reset' : 'Verify your account'}</h2><p>Hi ${name},</p><p>Your verification code is:</p><strong style="font-size:28px;letter-spacing:8px">${escapeHtml(job.otp)}</strong><p>This code expires in 10 minutes.</p>`
    };
  }

  if (job.type === 'WELCOME') {
    return {
      subject: 'Welcome to EventBook',
      text: 'Your EventBook account is verified and ready.',
      html: `<h2>Welcome to EventBook, ${name}!</h2><p>Your account is verified and ready. Browse upcoming events at <a href="${escapeHtml(process.env.FRONTEND_URL)}">EventBook</a>.</p>`
    };
  }

  if (job.type === 'BOOKING_CONFIRMATION' || job.type === 'BOOKING_CANCELLATION') {
    const cancelled = job.type === 'BOOKING_CANCELLATION';
    const title = escapeHtml(event.title || 'your event');
    const reference = escapeHtml(booking.bookingRef || '');
    const date = escapeHtml(event.date || 'To be announced');
    const venue = escapeHtml(event.venue || 'Venue to be announced');
    const amount = Number(booking.totalAmount || 0).toLocaleString('en-IN');
    const details = `Booking ${cancelled ? 'cancelled' : 'confirmed'}: ${reference}, ${title}, ${booking.seats || 0} seat(s), ${venue}, ${date}.`;
    return {
      subject: `${cancelled ? 'Booking cancelled' : 'Booking confirmed'} — ${title}`,
      text: `Hi ${job.name || ''}, ${details}${cancelled ? ' No payment was processed in this demo.' : ` Reservation value: ₹${amount}.`}`,
      html: `<h2>${cancelled ? 'Booking cancelled' : 'Booking confirmed'}</h2><p>Hi ${name},</p><p>${details}</p><p>${cancelled ? 'No payment was processed in this demo, so no refund is due.' : `Reservation value: ₹${amount}.`}</p>`
    };
  }

  throw new Error(`Unsupported email job type: ${job.type || 'unknown'}`);
}

async function processRecord(record) {
  const job = JSON.parse(record.body);
  if (!job.to || !process.env.EMAIL_FROM) {
    throw new Error('Email job is missing a recipient or EMAIL_FROM is not configured.');
  }

  const email = buildEmail(job);
  await ses.send(new SendEmailCommand({
    FromEmailAddress: process.env.EMAIL_FROM,
    Destination: { ToAddresses: [job.to] },
    Content: {
      Simple: {
        Subject: { Data: email.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: email.text, Charset: 'UTF-8' },
          Html: { Data: email.html, Charset: 'UTF-8' }
        }
      }
    }
  }));

}

exports.handler = async event => {
  const failures = [];
  for (const record of event.Records || []) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error(`Email job failed for ${record.messageId}:`, error);
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};
