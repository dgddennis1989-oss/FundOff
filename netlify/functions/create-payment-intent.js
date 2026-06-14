const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { amount, campaignId, campaignTitle, message } = JSON.parse(event.body);

    if (!amount || amount < 2000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Minimum donation is $20' }),
      };
    }

    const platformFee = Math.round(amount * 0.02);

    // Create Stripe Checkout Session instead of PaymentIntent
    // This uses Stripe's hosted payment page - no frontend Stripe.js needed
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Donation to: ${campaignTitle}`,
            description: message || 'FundOff Campaign Donation',
          },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `https://fundoff.org?donation=success&campaign=${campaignId}&amount=${amount}`,
      cancel_url: `https://fundoff.org?donation=cancelled`,
      metadata: {
        campaignId,
        campaignTitle,
        message: message || '',
        platformFee,
        fundoffVersion: '1.0',
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        checkoutUrl: session.url,
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
