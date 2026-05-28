const crypto = require("crypto");
const { json } = require("../_lib.cjs");
const { updateUserPlan } = require("./_users.cjs");

function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString("utf8"));
  if (typeof req.body === "string") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  const parts = Object.fromEntries(
    String(signatureHeader || "")
      .split(",")
      .map((part) => part.split("=", 2))
      .filter(([key, value]) => key && value)
  );
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  return timingSafeEqual(expected, parts.v1);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return json(res, 500, { error: "Stripe webhook is not configured." });

  try {
    const rawBody = await readRawBody(req);
    if (!verifyStripeSignature(rawBody, req.headers["stripe-signature"], webhookSecret)) {
      return json(res, 400, { error: "Invalid Stripe signature." });
    }

    const event = JSON.parse(rawBody);
    if (event.type === "checkout.session.completed" || event.type === "customer.subscription.created") {
      const object = event.data?.object || {};
      const userId = object.client_reference_id || object.metadata?.user_id;
      if (userId) {
        await updateUserPlan(userId, {
          billing_provider: "stripe",
          stripe_customer_id: object.customer || null,
          stripe_subscription_id: object.subscription || object.id || null,
        });
      }
    }

    return json(res, 200, { received: true });
  } catch (error) {
    return json(res, 500, { error: error.message || "Stripe webhook failed." });
  }
};
