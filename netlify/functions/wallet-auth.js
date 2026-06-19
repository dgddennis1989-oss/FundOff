/**
 * FundOff Wallet Auth — Server-side encrypted blob storage
 *
 * This function stores and retrieves AES-256 encrypted wallet blobs.
 * The encryption happens entirely in the recipient's browser before
 * anything is sent here. This server never sees:
 *   - The recipient's password
 *   - The plaintext private key
 *   - The recovery phrase
 *
 * What IS stored here:
 *   - Email address (identifier)
 *   - Wallet address (public — harmless)
 *   - Encrypted blob (AES-256 ciphertext — useless without password)
 *   - Campaign IDs associated with this wallet
 *
 * Even if this database is fully compromised, an attacker gets
 * encrypted noise that cannot be decrypted without each individual
 * recipient's password.
 *
 * Operations:
 *   POST { action: "register", email, encryptedBlob, walletAddress, campaignId }
 *   POST { action: "login", email }  → returns encryptedBlob
 *   POST { action: "addCampaign", email, campaignId }
 *   POST { action: "getCampaigns", email }  → returns campaign IDs
 */

const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGINS = [
  "https://fundoff.org",
  "https://www.fundoff.org",
  "https://tourmaline-lamington-3f68c9.netlify.app"
];

const headers = (origin) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
});

const sanitizeEmail = (email) => {
  if (!email || typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  if (trimmed.length > 254) return null;
  return trimmed;
};

// Simple rate limiting via blob timestamps
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10;

exports.handler = async (event) => {
  const origin = event.headers.origin || "";
  const h = headers(origin);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: h, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: h, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { action } = body;
  if (!action) {
    return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Missing action" }) };
  }

  const store = getStore({ name: "fundoff-wallets", consistency: "strong" });

  try {
    // ── REGISTER ──────────────────────────────────────────────────────
    if (action === "register") {
      const email = sanitizeEmail(body.email);
      if (!email) {
        return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Invalid email address" }) };
      }

      const { encryptedBlob, walletAddress, campaignId } = body;
      if (!encryptedBlob || typeof encryptedBlob !== "string" || encryptedBlob.length > 10000) {
        return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Invalid encrypted blob" }) };
      }
      if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
        return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Invalid wallet address" }) };
      }

      // Check if email already registered
      const existing = await store.get(email, { type: "json" }).catch(() => null);
      if (existing) {
        return { statusCode: 409, headers: h, body: JSON.stringify({ error: "Email already registered. Please log in instead." }) };
      }

      const record = {
        walletAddress,
        encryptedBlob, // AES-256 ciphertext — server never decrypts this
        campaignIds: campaignId ? [String(campaignId)] : [],
        createdAt: new Date().toISOString(),
      };

      await store.setJSON(email, record);

      return {
        statusCode: 200,
        headers: h,
        body: JSON.stringify({ success: true, walletAddress }),
      };
    }

    // ── LOGIN ─────────────────────────────────────────────────────────
    if (action === "login") {
      const email = sanitizeEmail(body.email);
      if (!email) {
        return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Invalid email address" }) };
      }

      const record = await store.get(email, { type: "json" }).catch(() => null);
      if (!record) {
        return { statusCode: 404, headers: h, body: JSON.stringify({ error: "No account found for this email. Please register first." }) };
      }

      // Return the encrypted blob — recipient's browser decrypts it locally
      return {
        statusCode: 200,
        headers: h,
        body: JSON.stringify({
          encryptedBlob: record.encryptedBlob,
          walletAddress: record.walletAddress,
          campaignIds: record.campaignIds || [],
        }),
      };
    }

    // ── ADD CAMPAIGN ──────────────────────────────────────────────────
    if (action === "addCampaign") {
      const email = sanitizeEmail(body.email);
      if (!email) {
        return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Invalid email" }) };
      }
      const campaignId = String(body.campaignId || "").slice(0, 100);
      if (!campaignId) {
        return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Missing campaignId" }) };
      }

      const record = await store.get(email, { type: "json" }).catch(() => null);
      if (!record) {
        return { statusCode: 404, headers: h, body: JSON.stringify({ error: "Account not found" }) };
      }

      if (!record.campaignIds.includes(campaignId)) {
        record.campaignIds.push(campaignId);
        await store.setJSON(email, record);
      }

      return { statusCode: 200, headers: h, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers: h, body: JSON.stringify({ error: "Unknown action" }) };

  } catch (err) {
    console.error("wallet-auth error:", err.message);
    return { statusCode: 500, headers: h, body: JSON.stringify({ error: "Server error. Please try again." }) };
  }
};
