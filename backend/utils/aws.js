// ============================================
//  AWS Utility — SNS + SQS Clients & Helpers
//  Path: event-booking/backend/utils/aws.js
// ============================================

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { S3Client } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { randomUUID } = require('crypto');

const region = process.env.AWS_REGION || 'ap-south-1';

// ---------- Clients ----------
const sqsClient = new SQSClient({ region });
const snsClient = new SNSClient({ region });
const s3Client = new S3Client({ region });

// ============================================
//  SQS: Enqueue an email job
//  Usage: await queueEmailJob({ type: 'OTP', to, otp, purpose })
// ============================================
async function queueEmailJob(payload) {
  if (process.env.USE_SQS_QUEUE !== 'true') {
    return { skipped: true };
  }
  if (!process.env.SQS_QUEUE_URL) {
    throw new Error('USE_SQS_QUEUE is enabled but SQS_QUEUE_URL is missing.');
  }

  try {
    const cmd = new SendMessageCommand({
      QueueUrl: process.env.SQS_QUEUE_URL,
      MessageBody: JSON.stringify({
        ...payload,
        enqueuedAt: new Date().toISOString(),
        source: 'eventbook-backend'
      }),
      MessageAttributes: {
        Type: {
          DataType: 'String',
          StringValue: payload.type || 'UNKNOWN'
        }
      },
      DelaySeconds: 0
    });

    const res = await sqsClient.send(cmd);
    console.log(`📦 SQS queued [${payload.type}] → MessageId: ${res.MessageId}`);
    return { messageId: res.MessageId };
  } catch (err) {
    console.error('❌ SQS send failed:', err.message);
    throw err;
  }
}

// ============================================
//  SNS: Publish a notification
//  Usage: await publishSNS('New Registration', 'Aditya joined')
// ============================================
async function publishSNS(subject, message, extra = {}) {
  if (!process.env.SNS_TOPIC_ARN) {
    return { skipped: true };
  }

  try {
    const cmd = new PublishCommand({
      TopicArn: process.env.SNS_TOPIC_ARN,
      Subject: subject.slice(0, 100), // SNS subject limit = 100 chars
      Message: message,
      MessageAttributes: {
        ...Object.fromEntries(
          Object.entries(extra).map(([k, v]) => [
            k,
            { DataType: 'String', StringValue: String(v) }
          ])
        )
      }
    });

    const res = await snsClient.send(cmd);
    console.log(`📣 SNS published: "${subject}" → MessageId: ${res.MessageId}`);
    return { messageId: res.MessageId };
  } catch (err) {
    console.error('❌ SNS publish failed:', err.message);
    throw err;
  }
}

async function createImageUpload(contentType) {
  const bucket = process.env.EVENT_IMAGE_BUCKET;
  const assetBaseUrl = process.env.ASSET_BASE_URL;
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  };
  const extension = extensions[contentType];
  if (!bucket || !assetBaseUrl || !extension) {
    throw new Error('Event image uploads are not configured for this deployment.');
  }

  const key = `uploads/${randomUUID()}.${extension}`;
  const cacheControl = 'public, max-age=31536000, immutable';
  const { url, fields } = await createPresignedPost(s3Client, {
    Bucket: bucket,
    Key: key,
    Expires: 300,
    Fields: {
      'Content-Type': contentType,
      'Cache-Control': cacheControl
    },
    Conditions: [
      ['content-length-range', 1, 5 * 1024 * 1024 + 65536],
      ['eq', '$Content-Type', contentType],
      ['eq', '$Cache-Control', cacheControl]
    ]
  });
  return {
    uploadUrl: url,
    fields,
    imageUrl: `${assetBaseUrl.replace(/\/+$/, '')}/${key}`
  };
}

// ============================================
//  Convenience: Notify new user registered
// ============================================
async function notifyNewUser(user) {
  return publishSNS(
    '🎫 New EventBook Registration',
    `Name : ${user.name}\nEmail: ${user.email}\nRole : ${user.role}\nTime : ${new Date().toISOString()}`,
    { eventType: 'USER_REGISTERED', userId: String(user._id) }
  );
}

// ============================================
//  Convenience: Notify new booking
// ============================================
async function notifyNewBooking(booking, user, event) {
  return publishSNS(
    '🎟️ New Booking on EventBook',
    `Booking Ref : ${booking.bookingRef}\n` +
      `User        : ${user.name} <${user.email}>\n` +
      `Event       : ${event.title}\n` +
      `Seats       : ${booking.seats}\n` +
      `Reservation : ₹${booking.totalAmount}\n` +
      `Method      : ${booking.paymentMethod}`,
    { eventType: 'BOOKING_CREATED', bookingRef: booking.bookingRef }
  );
}

// ============================================
//  Convenience: Notify booking cancelled
// ============================================
async function notifyBookingCancelled(booking, user) {
  return publishSNS(
    '❌ Booking Cancelled',
    `Booking Ref : ${booking.bookingRef}\n` +
      `User        : ${user.name} <${user.email}>\n` +
      `Reservation : ₹${booking.totalAmount}\n` +
      `Reason      : ${booking.cancellationReason || 'Not specified'}`,
    { eventType: 'BOOKING_CANCELLED', bookingRef: booking.bookingRef }
  );
}

// ============================================
//  Should we use SQS? (check env flag)
// ============================================
function useSQS() {
  return process.env.USE_SQS_QUEUE === 'true';
}

module.exports = {
  sqsClient,
  snsClient,
  AWS_ENABLED: Boolean(process.env.AWS_REGION),
  useSQS,
  queueEmailJob,
  createImageUpload,
  publishSNS,
  notifyNewUser,
  notifyNewBooking,
  notifyBookingCancelled
};