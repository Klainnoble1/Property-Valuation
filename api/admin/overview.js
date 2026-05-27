const { adminEmails, authToken, json, summarizeAdminData, supabaseServiceFetch, verifySupabaseUser } = require("../_lib.cjs");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  const token = authToken(req);
  if (!token) return json(res, 401, { error: "Missing session token" });

  try {
    const currentUser = await verifySupabaseUser(token);
    if (!currentUser?.email || !adminEmails().has(currentUser.email.toLowerCase())) {
      return json(res, 403, { error: "Admin access is not enabled for this account." });
    }

    const [usersPayload, reports] = await Promise.all([
      supabaseServiceFetch("/auth/v1/admin/users?page=1&per_page=1000"),
      supabaseServiceFetch("/rest/v1/valuation_reports?select=id,user_id,address,zpid,zestimate,cma_mid,score,report,created_at&order=created_at.desc&limit=1000"),
    ]);
    return json(res, 200, summarizeAdminData(usersPayload, reports || []));
  } catch (error) {
    return json(res, 500, { error: error.message || "Admin overview failed" });
  }
};
