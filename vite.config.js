import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
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

async function runOpenAiAnalysis(env, prompt) {
  const apiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set on the local server.");

  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || env.OPENAI_MODEL || "gpt-5.2",
      input: prompt,
      max_output_tokens: 1800,
    }),
  });

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) throw new Error(data?.error?.message || `OpenAI request failed (${upstream.status})`);
  return { text: extractOutputText(data), id: data?.id, provider: "openai" };
}

async function runGeminiAnalysis(env, prompt) {
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    env.GEMINI_API_KEY ||
    env.GOOGLE_GENERATIVE_AI_API_KEY ||
    env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Gemini API key is not set on the local server.");

  const model = process.env.GEMINI_MODEL || env.GEMINI_MODEL || "gemini-2.5-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let upstream;
  try {
    upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const message = data?.error?.message || `Gemini request failed (${upstream.status})`;
    throw new Error(message);
  }

  return { text: extractGeminiText(data), id: data?.responseId, provider: "gemini" };
}

function aiAnalyzeMiddleware(env) {
  return {
    name: "ai-analyze-api",
    configureServer(server) {
      server.middlewares.use("/api/analyze", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        try {
          const { prompt } = JSON.parse(await readBody(req));
          const provider = (process.env.AI_PROVIDER || env.AI_PROVIDER || "gemini").toLowerCase();
          const data = provider === "openai"
            ? await runOpenAiAnalysis(env, prompt)
            : await runGeminiAnalysis(env, prompt);

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(data));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: error.message || "AI analysis failed" }));
        }
      });
    },
  };
}

const RAPIDAPI_HOST = "real-time-real-estate-data.p.rapidapi.com";
const RAPIDAPI_ALLOWED_PATHS = new Set([
  "/property-details-address",
  "/property-details",
  "/search",
  "/zestimate",
]);

function rapidApiMiddleware(env) {
  return {
    name: "rapidapi-real-estate-api",
    configureServer(server) {
      server.middlewares.use("/api/rapidapi", async (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        const apiKey = process.env.RAPIDAPI_KEY || env.RAPIDAPI_KEY;
        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "RAPIDAPI_KEY is not set on the local server." }));
          return;
        }

        try {
          const incomingUrl = new URL(req.url || "", "http://127.0.0.1");
          const path = incomingUrl.searchParams.get("path");
          if (!RAPIDAPI_ALLOWED_PATHS.has(path)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Unsupported RapidAPI path." }));
            return;
          }

          const upstreamUrl = new URL(`https://${RAPIDAPI_HOST}${path}`);
          incomingUrl.searchParams.forEach((value, key) => {
            if (key !== "path") upstreamUrl.searchParams.set(key, value);
          });

          const upstream = await fetch(upstreamUrl, {
            headers: {
              "X-RapidAPI-Key": apiKey,
              "X-RapidAPI-Host": RAPIDAPI_HOST,
            },
          });

          res.statusCode = upstream.status;
          res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
          res.end(await upstream.text());
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: error.message || "RapidAPI request failed" }));
        }
      });
    },
  };
}

function getEnv(env, key) {
  return process.env[key] || env[key];
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function supabaseServiceFetch(env, path, options = {}) {
  const supabaseUrl = getEnv(env, "NEXT_PUBLIC_SUPABASE_URL") || getEnv(env, "VITE_SUPABASE_URL");
  const serviceRoleKey = getEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase URL or service role key is not configured on the local server.");
  }

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
  if (!response.ok) {
    throw new Error(data?.message || data?.error_description || data?.error || `Supabase request failed (${response.status})`);
  }
  return data;
}

async function verifySupabaseUser(env, token) {
  const supabaseUrl = getEnv(env, "NEXT_PUBLIC_SUPABASE_URL") || getEnv(env, "VITE_SUPABASE_URL");
  const publishableKey =
    getEnv(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
    getEnv(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
    getEnv(env, "VITE_SUPABASE_PUBLISHABLE_KEY") ||
    getEnv(env, "VITE_SUPABASE_ANON_KEY");
  if (!supabaseUrl || !publishableKey) {
    throw new Error("Supabase public auth configuration is missing.");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return null;
  return data;
}

function adminEmails(env) {
  return new Set(
    (getEnv(env, "ADMIN_EMAILS") || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeAddress(address = "") {
  return String(address)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function readCachedProperty(env, address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;

  try {
    const rows = await supabaseServiceFetch(
      env,
      `/rest/v1/property_analysis_cache?select=address,zpid,report,zillow_raw,updated_at&normalized_address=eq.${encodeURIComponent(normalized)}&limit=1`
    );
    const row = rows?.[0];
    if (row) {
      return {
        address: row.address,
        zpid: row.zpid,
        report: row.report,
        zillowRaw: row.zillow_raw,
        updatedAt: row.updated_at,
        source: "property_analysis_cache",
      };
    }
  } catch {}

  try {
    const rows = await supabaseServiceFetch(
      env,
      `/rest/v1/valuation_reports?select=address,zpid,report,created_at&address=eq.${encodeURIComponent(address)}&order=created_at.desc&limit=1`
    );
    const row = rows?.[0];
    if (row) {
      return {
        address: row.address,
        zpid: row.zpid,
        report: row.report,
        zillowRaw: null,
        updatedAt: row.created_at,
        source: "valuation_reports",
      };
    }
  } catch {}

  return null;
}

async function writeCachedProperty(env, payload) {
  const normalized = normalizeAddress(payload.address);
  if (!normalized || !payload.report) return false;
  await supabaseServiceFetch(env, "/rest/v1/property_analysis_cache?on_conflict=normalized_address", {
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

function propertyCacheMiddleware(env) {
  return {
    name: "propval-property-cache-api",
    configureServer(server) {
      server.middlewares.use("/api/property-cache", async (req, res) => {
        const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
        if (!token) {
          json(res, 401, { error: "Missing session token" });
          return;
        }

        try {
          const currentUser = await verifySupabaseUser(env, token);
          if (!currentUser?.id) {
            json(res, 401, { error: "Invalid session token" });
            return;
          }

          if (req.method === "GET") {
            const incomingUrl = new URL(req.url || "", "http://127.0.0.1");
            const address = incomingUrl.searchParams.get("address") || "";
            json(res, 200, { cache: await readCachedProperty(env, address) });
            return;
          }

          if (req.method === "POST") {
            const payload = JSON.parse(await readBody(req));
            try {
              const saved = await writeCachedProperty(env, payload);
              json(res, 200, { saved });
            } catch (error) {
              json(res, 200, { saved: false, warning: error.message || "Cache table is not ready." });
            }
            return;
          }

          json(res, 405, { error: "Method not allowed" });
        } catch (error) {
          json(res, 500, { error: error.message || "Property cache failed" });
        }
      });
    },
  };
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
    const latest = userReports[0];
    const scores = userReports.map((report) => Number(report.score)).filter(Number.isFinite);
    const avgScore = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null;
    return {
      id: user.id,
      email: user.email || "Unknown",
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at,
      plan: user.raw_user_meta_data?.plan || user.user_metadata?.plan || "free",
      searchCount: userReports.length,
      lastSearchAt: latest?.created_at || null,
      avgScore,
    };
  });

  const scoredReports = reports.map((report) => Number(report.score)).filter(Number.isFinite);
  const totalValuation = reports
    .map((report) => Number(report.cma_mid || report.zestimate))
    .filter(Number.isFinite)
    .reduce((sum, value) => sum + value, 0);

  const metrics = {
    totalUsers: users.length,
    totalSearches: reports.length,
    searchesLast24h: reports.filter((report) => now - new Date(report.created_at).getTime() <= dayMs).length,
    activeUsers: new Set(reports.map((report) => report.user_id)).size,
    averageScore: scoredReports.length ? Math.round(scoredReports.reduce((sum, value) => sum + value, 0) / scoredReports.length) : null,
    totalValuation,
  };

  const recentSearches = reports.slice(0, 100).map((report) => {
    const user = usersById.get(report.user_id);
    return {
      id: report.id,
      userId: report.user_id,
      userEmail: user?.email || "Unknown",
      address: report.address,
      estimate: report.zestimate,
      valuation: report.cma_mid,
      score: report.score,
      rehabStyle: report.report?.rehab?.label || null,
      createdAt: report.created_at,
      verdict: report.report?.analysis?.verdict || "",
    };
  });

  return { metrics, users: userRows, recentSearches };
}

function adminMiddleware(env) {
  return {
    name: "propval-admin-api",
    configureServer(server) {
      server.middlewares.use("/api/admin/status", async (req, res) => {
        if (req.method !== "GET") {
          json(res, 405, { error: "Method not allowed" });
          return;
        }

        const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
        if (!token) {
          json(res, 200, { isAdmin: false });
          return;
        }

        try {
          const currentUser = await verifySupabaseUser(env, token);
          json(res, 200, {
            isAdmin: Boolean(currentUser?.email && adminEmails(env).has(currentUser.email.toLowerCase())),
          });
        } catch {
          json(res, 200, { isAdmin: false });
        }
      });

      server.middlewares.use("/api/admin/overview", async (req, res) => {
        if (req.method !== "GET") {
          json(res, 405, { error: "Method not allowed" });
          return;
        }

        const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
        if (!token) {
          json(res, 401, { error: "Missing session token" });
          return;
        }

        try {
          const currentUser = await verifySupabaseUser(env, token);
          if (!currentUser?.email || !adminEmails(env).has(currentUser.email.toLowerCase())) {
            json(res, 403, { error: "Admin access is not enabled for this account." });
            return;
          }

          const [usersPayload, reports] = await Promise.all([
            supabaseServiceFetch(env, "/auth/v1/admin/users?page=1&per_page=1000"),
            supabaseServiceFetch(
              env,
              "/rest/v1/valuation_reports?select=id,user_id,address,zpid,zestimate,cma_mid,score,report,created_at&order=created_at.desc&limit=1000"
            ),
          ]);

          json(res, 200, summarizeAdminData(usersPayload, reports || []));
        } catch (error) {
          json(res, 500, { error: error.message || "Admin overview failed" });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    plugins: [react(), rapidApiMiddleware(env), aiAnalyzeMiddleware(env), propertyCacheMiddleware(env), adminMiddleware(env)],
  };
});
