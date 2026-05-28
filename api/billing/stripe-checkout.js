const { authToken, json, requestBody, verifySupabaseUser } = require("../_lib.cjs");

function originFromReq(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const token = authToken(req);
  if (!token) return json(res, 401, { error: "Missing session token" });

  try {
    const currentUser = await verifySupabaseUser(token);
    if (!currentUser?.id || !currentUser?.email) return json(res, 401, { error: "Invalid session token" });

    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId = process.env.STRIPE_PREMIUM_PRICE_ID;
    if (!secretKey || !priceId) return json(res, 500, { error: "Stripe billing is not configured." });

    const body = await requestBody(req).catch(() => ({}));
    const origin = body.origin || originFromReq(req);
    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("line_items[0][price]", priceId);
    params.set("line_items[0][quantity]", "1");
    params.set("customer_email", currentUser.email);
    params.set("client_reference_id", currentUser.id);
    params.set("metadata[user_id]", currentUser.id);
    params.set("metadata[plan]", "premium");
    params.set("success_url", `${origin}?billing=success&provider=stripe`);
    params.set("cancel_url", `${origin}?billing=cancelled&provider=stripe`);

    const upstream = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok) return json(res, upstream.status, { error: data?.error?.message || "Stripe checkout failed." });
    return json(res, 200, { url: data.url, id: data.id });
  } catch (error) {
    return json(res, 500, { error: error.message || "Stripe checkout failed." });
  }
};
