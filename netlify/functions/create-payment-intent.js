const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ─── Security helpers ─────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = ['https://fundoff.org', 'https://www.fundoff.org', 'https://tourmaline-lamington-3f68c9.netlify.app'];
const RATE_LIMIT = {};
const RATE_WINDOW = 60000; // 1 minute
const MAX_REQUESTS = 10;   // max 10 payment attempts per IP per minute

const getHeaders = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
});

const checkRateLimit = (ip) => {
  const now = Date.now();
  if(!RATE_LIMIT[ip]) RATE_LIMIT[ip] = [];
  // Clean old entries
  RATE_LIMIT[ip] = RATE_LIMIT[ip].filter(t => now - t < RATE_WINDOW);
  if(RATE_LIMIT[ip].length >= MAX_REQUESTS) return false;
  RATE_LIMIT[ip].push(now);
  return true;
};

const sanitize = (str, maxLen=500) => {
  if(!str) return '';
  return String(str).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
};

exports.handler = async (event) => {
  const origin = event.headers.origin || '';
  const headers = getHeaders(origin);
  const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';

  // Handle preflight
  if(event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if(event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Rate limiting
  if(!checkRateLimit(ip)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' }),
    };
  }

  try {
    const body = JSON.parse(event.body);
    const amount       = parseInt(body.amount);
    const campaignId   = sanitize(body.campaignId, 100);
    const campaignTitle = sanitize(body.campaignTitle, 200);
    const message      = sanitize(body.message, 500);

    // Validate amount
    if(!amount || isNaN(amount) || amount < 2000 || amount > 100000000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid donation amount. Minimum $20, maximum $1,000,000.' }),
      };
    }

    // Validate required fields
    if(!campaignId || !campaignTitle) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required campaign information.' }),
      };
    }

    const platformFee = Math.round(amount * 0.02);

    // Alert on high value donations for fraud monitoring
    if(amount >= 100000) { // $1,000+
      console.log(`HIGH VALUE DONATION ALERT: $${amount/100} to campaign: ${campaignTitle} (ID: ${campaignId}) from IP: ${ip}`);
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        campaignId,
        campaignTitle,
        message,
        platformFee,
        donorIp: ip,
        fundoffVersion: '1.0',
      },
      description: `FundOff donation: ${campaignTitle}`,
      statement_descriptor_suffix: 'FUNDOFF',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        platformFee,
        recipientAmount: amount - platformFee,
      }),
    };

  } catch(err) {
    console.error('Payment error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Payment processing failed. Please try again.' }),
    };
  }
};
