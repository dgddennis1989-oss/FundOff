const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Creates a Stripe Connect Express account for campaign recipients
 * and returns an onboarding URL they complete once.
 * After completion Stripe handles all payouts automatically.
 */
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': 'https://fundoff.org',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const { email, campaignId, campaignTitle, returnUrl } = JSON.parse(event.body);

    if (!email || !campaignId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email and campaign ID required' }),
      };
    }

    // Create a Stripe Connect Express account
    // Express = Stripe handles compliance, KYC, and the dashboard
    // Recipient only needs to complete a simple onboarding form
    const account = await stripe.accounts.create({
      type: 'express',
      email,
      capabilities: {
        transfers: { requested: true },
        card_payments: { requested: true },
      },
      business_type: 'individual',
      metadata: {
        campaignId,
        campaignTitle,
        fundoffPlatform: 'true',
      },
      settings: {
        payouts: {
          schedule: {
            interval: 'daily', // Payout every day automatically
          },
        },
      },
    });

    // Generate onboarding link — recipient completes this once
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: returnUrl || 'https://fundoff.org?connect=refresh',
      return_url:  returnUrl || 'https://fundoff.org?connect=success',
      type: 'account_onboarding',
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        accountId:     account.id,
        onboardingUrl: accountLink.url,
        message:       'Complete the onboarding to receive automatic bank payouts',
      }),
    };

  } catch (err) {
    console.error('Stripe Connect error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
