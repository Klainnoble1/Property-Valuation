const { authToken, json, readCachedProperty, requestBody, verifySupabaseUser, writeCachedProperty } = require("./_lib.cjs");

module.exports = async function handler(req, res) {
  const token = authToken(req);
  if (!token) return json(res, 401, { error: "Missing session token" });

  try {
    const currentUser = await verifySupabaseUser(token);
    if (!currentUser?.id) return json(res, 401, { error: "Invalid session token" });

    if (req.method === "GET") {
      return json(res, 200, { cache: await readCachedProperty(req.query.address || "") });
    }

    if (req.method === "POST") {
      try {
        return json(res, 200, { saved: await writeCachedProperty(await requestBody(req)) });
      } catch (error) {
        return json(res, 200, { saved: false, warning: error.message || "Cache table is not ready." });
      }
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, 500, { error: error.message || "Property cache failed" });
  }
};
