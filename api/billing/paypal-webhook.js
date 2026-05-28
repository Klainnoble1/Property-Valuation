const { json } = require("../_lib.cjs");
const { updateUserPlan } = require("./_users.cjs");

function paypalBaseUrl() {
  return String(process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(JSON.parse(req.body || "{}"));
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

async function getAccessToken(baseUrl, clientId, clientSecret) {
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error_description || data?.error || "PayPal authentication failed.");
  return data.access_token;
}

async function verifyPayPalWebhook(baseUrl, accessToken, req, event) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not configured.");

  const response = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: req.headers["paypal-auth-algo"],
      cert_url: req.headers["paypal-cert-url"],
      transmission_id: req.headers["paypal-transmission-id"],
      transmission_sig: req.headers["paypal-transmission-sig"],
      transmission_time: req.headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.verification_status !== "SUCCESS") throw new Error("Invalid PayPal webhook signature.");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return json(res, 500, { error: "PayPal webhook is not configured." });

  try {
    const event = await readBody(req);
    const baseUrl = paypalBaseUrl();
    const accessToken = await getAccessToken(baseUrl, clientId, clientSecret);
    await verifyPayPalWebhook(baseUrl, accessToken, req, event);

    if (event.event_type === "BILLING.SUBSCRIPTION.ACTIVATED") {
      const resource = event.resource || {};
      const userId = resource.custom_id;
      if (userId) {
        await updateUserPlan(userId, {
          billing_provider: "paypal",
          paypal_subscription_id: resource.id || null,
        });
      }
    }

    return json(res, 200, { received: true });
  } catch (error) {
    return json(res, 500, { error: error.message || "PayPal webhook failed." });
  }
};
