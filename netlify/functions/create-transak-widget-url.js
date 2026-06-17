/**
 * Generates a one-time Transak widget URL so a donor can pay with a card
 * and have USDC delivered directly to a campaign's escrow-receiving flow.
 *
 * This replaces Stripe as the PRIMARY donation path. Stripe remains
 * available as a secondary, clearly-disclaimed option for donors who
 * will not use crypto at all.
 *
 * Two-step server-side flow required by Transak's current API:
 *   1. Exchange our API secret for a short-lived Partner Access Token
 *   2. Use that token to request a single-use widget URL
 *
 * The widget URL expires 5 minutes after creation and is single-use,
 * so we generate a fresh one on every donate click rather than caching.
 */

const TRANSAK_API_KEY = process.env.TRANSAK_API_KEY;       // public-safe, but we still keep server-side for consistency
const TRANSAK_API_SECRET = process.env.TRANSAK_API_SECRET; // private, never expose to frontend
const TRANSAK_ENV = process.env.TRANSAK_ENV || 'STAGING';  // STAGING or PRODUCTION

const BASE_URL = TRANSAK_ENV === 'PRODUCTION'
  ? 'https://api-gateway.transak.com'
  : 'https://api-gateway-stg.transak.com';

const ALLOWED_ORIGINS = ['https://fundoff.org', 'https://www.fundoff.org', 'https://tourmaline-lamington-3f68c9.netlify.app'];

const getHeaders = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
});

const sanitize = (str, maxLen = 200) => {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
};

exports.handler = async (event) => {
  const origin = event.headers.origin || '';
  const headers = getHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!TRANSAK_API_KEY || !TRANSAK_API_SECRET) {
    console.error('Transak credentials missing from environment');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Crypto payment temporarily unavailable' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const walletAddress = sanitize(body.walletAddress, 100); // the FundOff campaign contract address — all donations route here
    const fiatAmount = parseFloat(body.fiatAmount);
    const campaignId = sanitize(body.campaignId, 100);

    if (!walletAddress) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing destination wallet address' }) };
    }
    if (!fiatAmount || isNaN(fiatAmount) || fiatAmount < 20) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Minimum donation is $20' }) };
    }

    // ── Step 1: Get a Partner Access Token using our API secret ──
    const tokenRes = await fetch(`${BASE_URL}/partners/api/v2/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-secret': TRANSAK_API_SECRET },
      body: JSON.stringify({ apiKey: TRANSAK_API_KEY }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData?.data?.accessToken) {
      console.error('Transak token error:', tokenData);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not start crypto payment session' }) };
    }
    const accessToken = tokenData.data.accessToken;

    // ── Step 2: Create a single-use widget URL with that token ──
    const widgetRes = await fetch(`${BASE_URL}/api/v2/auth/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access-token': accessToken,
      },
      body: JSON.stringify({
        widgetParams: {
          apiKey: TRANSAK_API_KEY,
          referrerDomain: 'fundoff.org',
          environment: TRANSAK_ENV,
          fiatAmount,
          fiatCurrency: 'USD',
          cryptoCurrencyCode: 'USDC',
          network: 'base',
          walletAddress,
          disableWalletAddressForm: true, // donor never sees or edits the destination — it's always the campaign contract
          partnerCustomerId: campaignId,
          themeColor: 'ff4444',
          hideMenu: true,
        },
      }),
    });
    const widgetData = await widgetRes.json();
    if (!widgetRes.ok || !widgetData?.data?.widgetUrl) {
      console.error('Transak widget URL error:', widgetData);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not create crypto payment link' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ widgetUrl: widgetData.data.widgetUrl }),
    };

  } catch (err) {
    console.error('Transak integration error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Crypto payment failed to initialize. Please try again.' }) };
  }
};
