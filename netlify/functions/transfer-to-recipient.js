const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Transfers donation funds to the recipient's connected Stripe account.
 * Called automatically after each successful donation payment.
 * FundOff keeps the platform fee, rest goes to recipient.
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
    const {
      paymentIntentId,
      connectedAccountId,
      amount,          // total donation in cents
      feeBps,          // platform fee basis points (200 = 2%)
      campaignTitle,
    } = JSON.parse(event.body);

    if (!connectedAccountId || !amount) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }

    const platformFee    = Math.round(amount * (feeBps / 10000));
    const transferAmount = amount - platformFee;

    // Transfer to recipient's connected account
    // FundOff automatically keeps the platform fee
    const transfer = await stripe.transfers.create({
      amount:      transferAmount,
      currency:    'usd',
      destination: connectedAccountId,
      description: `FundOff donation: ${campaignTitle}`,
      metadata: {
        paymentIntentId,
        platformFee,
        feeBps,
        fundoffVersion: '1.0',
      },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        transferId:      transfer.id,
        transferAmount,
        platformFee,
        status:          transfer.reversed ? 'reversed' : 'succeeded',
      }),
    };

  } catch (err) {
    console.error('Transfer error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
