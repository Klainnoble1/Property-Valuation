const RAPIDAPI_HOST = "real-time-real-estate-data.p.rapidapi.com";
const RAPIDAPI_ALLOWED_PATHS = new Set([
  "/property-details-address",
  "/property-details",
  "/search",
  "/zestimate",
]);

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function getEnv(key) {
  return process.env[key];
}

function requestBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(JSON.parse(req.body || "{}"));
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function extractOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text" || part.type === "text")
    .map((part) => part.text || "")
    .join("");
}

function extractGeminiText(data) {
  return (data?.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .join("");
}

async function runOpenAiAnalysis(prompt) {
  const apiKey = getEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: getEnv("OPENAI_MODEL") || "gpt-5.2",
      input: prompt,
      max_output_tokens: 1800,
    }),
  });
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) throw new Error(data?.error?.message || `OpenAI request failed (${upstream.status})`);
  return { text: extractOutputText(data), id: data?.id, provider: "openai" };
}

async function runGeminiAnalysis(prompt) {
  const apiKey = getEnv("GEMINI_API_KEY") || getEnv("GOOGLE_GENERATIVE_AI_API_KEY") || getEnv("GOOGLE_API_KEY");
  if (!apiKey) throw new Error("Gemini API key is not set. Add GEMINI_API_KEY in your deployment environment.");
  const model = getEnv("GEMINI_MODEL") || "gemini-2.5-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let upstream;
  try {
    upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) throw new Error(data?.error?.message || `Gemini request failed (${upstream.status})`);
  return { text: extractGeminiText(data), id: data?.responseId, provider: "gemini" };
}

async function analyze(prompt) {
  const provider = (getEnv("AI_PROVIDER") || "gemini").toLowerCase();
  return provider === "openai" ? runOpenAiAnalysis(prompt) : runGeminiAnalysis(prompt);
}

async function supabaseServiceFetch(path, options = {}) {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase service configuration is missing.");
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || data?.error_description || data?.error || `Supabase request failed (${response.status})`);
  return data;
}

async function verifySupabaseUser(token) {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL") || getEnv("VITE_SUPABASE_URL");
  const publishableKey =
    getEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
    getEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ||
    getEnv("VITE_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !publishableKey) throw new Error("Supabase public auth configuration is missing.");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => null);
  return response.ok ? data : null;
}

function authToken(req) {
  return (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function adminEmails() {
  return new Set((getEnv("ADMIN_EMAILS") || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

function normalizeAddress(address = "") {
  return String(address).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

async function readCachedProperty(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  try {
    const rows = await supabaseServiceFetch(`/rest/v1/property_analysis_cache?select=address,zpid,report,zillow_raw,updated_at&normalized_address=eq.${encodeURIComponent(normalized)}&limit=1`);
    const row = rows?.[0];
    if (row) return { address: row.address, zpid: row.zpid, report: row.report, zillowRaw: row.zillow_raw, updatedAt: row.updated_at, source: "property_analysis_cache" };
  } catch {}
  try {
    const rows = await supabaseServiceFetch(`/rest/v1/valuation_reports?select=address,zpid,report,created_at&address=eq.${encodeURIComponent(address)}&order=created_at.desc&limit=1`);
    const row = rows?.[0];
    if (row) return { address: row.address, zpid: row.zpid, report: row.report, zillowRaw: null, updatedAt: row.created_at, source: "valuation_reports" };
  } catch {}
  return null;
}

async function writeCachedProperty(payload) {
  const normalized = normalizeAddress(payload.address);
  if (!normalized || !payload.report) return false;
  await supabaseServiceFetch("/rest/v1/property_analysis_cache?on_conflict=normalized_address", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      normalized_address: normalized,
      address: payload.address,
      zpid: payload.zpid || null,
      report: payload.report,
      zillow_raw: payload.zillowRaw || null,
      updated_at: new Date().toISOString(),
    }),
  });
  return true;
}

function summarizeAdminData(usersPayload, reports) {
  const users = usersPayload?.users || [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const reportGroups = new Map();
  for (const report of reports) {
    const group = reportGroups.get(report.user_id) || [];
    group.push(report);
    reportGroups.set(report.user_id, group);
  }
  const userRows = users.map((user) => {
    const userReports = reportGroups.get(user.id) || [];
    const scores = userReports.map((report) => Number(report.score)).filter(Number.isFinite);
    return {
      id: user.id,
      email: user.email || "Unknown",
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at,
      plan: user.raw_user_meta_data?.plan || user.user_metadata?.plan || "free",
      searchCount: userReports.length,
      lastSearchAt: userReports[0]?.created_at || null,
      avgScore: scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null,
    };
  });
  const scoredReports = reports.map((report) => Number(report.score)).filter(Number.isFinite);
  const totalValuation = reports.map((report) => Number(report.cma_mid || report.zestimate)).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  return {
    metrics: {
      totalUsers: users.length,
      totalSearches: reports.length,
      searchesLast24h: reports.filter((report) => now - new Date(report.created_at).getTime() <= dayMs).length,
      activeUsers: new Set(reports.map((report) => report.user_id)).size,
      averageScore: scoredReports.length ? Math.round(scoredReports.reduce((sum, value) => sum + value, 0) / scoredReports.length) : null,
      totalValuation,
    },
    users: userRows,
    recentSearches: reports.slice(0, 100).map((report) => ({
      id: report.id,
      userId: report.user_id,
      userEmail: usersById.get(report.user_id)?.email || "Unknown",
      address: report.address,
      estimate: report.zestimate,
      valuation: report.cma_mid,
      score: report.score,
      rehabStyle: report.report?.rehab?.label || null,
      pipelineStatus: report.report?.meta?.pipelineStatus || "New Lead",
      lead: report.report?.meta?.lead || null,
      compConfidence: report.report?.meta?.compConfidence?.score || null,
      createdAt: report.created_at,
      verdict: report.report?.analysis?.verdict || "",
    })),
  };
}

module.exports = {
  RAPIDAPI_ALLOWED_PATHS,
  RAPIDAPI_HOST,
  adminEmails,
  analyze,
  authToken,
  json,
  readCachedProperty,
  requestBody,
  summarizeAdminData,
  supabaseServiceFetch,
  verifySupabaseUser,
  writeCachedProperty,
};
