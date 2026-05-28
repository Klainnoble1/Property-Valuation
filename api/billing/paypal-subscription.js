const { authToken, json, requestBody, verifySupabaseUser } = require("../_lib.cjs");

function originFromReq(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function paypalBaseUrl() {
  return String(process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const token = authToken(req);
  if (!token) return json(res, 401, { error: "Missing session token" });

  try {
    const currentUser = await verifySupabaseUser(token);
    if (!currentUser?.id || !currentUser?.email) return json(res, 401, { error: "Invalid session token" });

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const planId = process.env.PAYPAL_PREMIUM_PLAN_ID;
    if (!clientId || !clientSecret || !planId) return json(res, 500, { error: "PayPal billing is not configured." });

    const body = await requestBody(req).catch(() => ({}));
    const origin = body.origin || originFromReq(req);
    const baseUrl = paypalBaseUrl();
    const accessToken = await getAccessToken(baseUrl, clientId, clientSecret);

    const upstream = await fetch(`${baseUrl}/v1/billing/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        plan_id: planId,
        custom_id: currentUser.id,
        subscriber: { email_address: currentUser.email },
        application_context: {
          brand_name: "PropVal",
          user_action: "SUBSCRIBE_NOW",
          return_url: `${origin}?billing=success&provider=paypal`,
          cancel_url: `${origin}?billing=cancelled&provider=paypal`,
        },
      }),
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) return json(res, upstream.status, { error: data?.message || data?.details?.[0]?.issue || "PayPal subscription failed." });

    const approvalUrl = (data.links || []).find((link) => link.rel === "approve")?.href;
    if (!approvalUrl) return json(res, 500, { error: "PayPal did not return an approval link." });
    return json(res, 200, { url: approvalUrl, id: data.id });
  } catch (error) {
    return json(res, 500, { error: error.message || "PayPal subscription failed." });
  }
};
