const { adminEmails, authToken, json, verifySupabaseUser } = require("../_lib.cjs");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  const token = authToken(req);
  if (!token) return json(res, 200, { isAdmin: false });
  try {
    const currentUser = await verifySupabaseUser(token);
    return json(res, 200, {
      isAdmin: Boolean(currentUser?.email && adminEmails().has(currentUser.email.toLowerCase())),
    });
  } catch {
    return json(res, 200, { isAdmin: false });
  }
};
