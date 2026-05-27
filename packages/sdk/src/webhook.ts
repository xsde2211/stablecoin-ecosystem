/**
 * Webhook event types your server will receive from the platform
 */
export type WebhookEventType =
  | 'payment.paid'
  | 'payment.expired'
  | 'payment.refunded'
  | 'bridge.completed'
  | 'bridge.failed'
  | 'kyc.approved'
  | 'kyc.rejected';

export interface WebhookEvent<T = unknown> {
  id:        string;
  type:      WebhookEventType;
  data:      T;
  createdAt: string;
}

/**
 * Express/NestJS middleware to verify + parse webhook events.
 *
 * Usage in Express:
 *   app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
 *     const event = parseWebhook(req.body.toString(), req.headers['x-signature'], YOUR_API_KEY);
 *     if (!event) return res.status(400).send('Invalid signature');
 *     // handle event.type
 *   });
 */
export function parseWebhook(
  rawBody:   string,
  signature: string,
  apiKey:    string,
): WebhookEvent | null {
  const crypto = require('crypto');

  const expected = crypto
    .createHmac('sha256', apiKey)
    .update(rawBody)
    .digest('hex');

  const valid = crypto.timingSafeEqual(
    Buffer.from(expected,  'hex'),
    Buffer.from(signature, 'hex'),
  );

  if (!valid) return null;

  try {
    return JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return null;
  }
}