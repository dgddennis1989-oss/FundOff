const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': 'https://fundoff.org',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const { amount, campaignId, campaignTitle, message } = JSON.parse(event.body);

    // Validate minimum $20
    if (!amount || amount < 2000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Minimum donation is $20' }),
      };
    }

    // Calculate platform fee (2% — adjust based on tier in production)
    const platformFee = Math.round(amount * 0.02);

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,               // in cents e.g. 2000 = $20.00
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        campaignId,
        campaignTitle,
        message: message || '',
        platformFee,
        fundoffVersion: '1.0',
      },
      description: `FundOff donation to: ${campaignTitle}`,
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

  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
