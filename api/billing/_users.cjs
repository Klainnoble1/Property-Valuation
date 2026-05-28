const { supabaseServiceFetch } = require("../_lib.cjs");

async function updateUserPlan(userId, metadata) {
  if (!userId) throw new Error("Missing billing user id.");
  const current = await supabaseServiceFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);
  const nextMetadata = {
    ...(current?.user_metadata || current?.raw_user_meta_data || {}),
    plan: "premium",
    premium_since: new Date().toISOString(),
    ...metadata,
  };
  return supabaseServiceFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify({ user_metadata: nextMetadata }),
  });
}

module.exports = { updateUserPlan };
