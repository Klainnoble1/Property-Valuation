import { readFileSync } from "node:fs";

function loadEnv() {
  const raw = readFileSync(".env", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    process.env[key] ||= value;
  }
}

async function supabaseFetch(path, options = {}) {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.msg || data?.message || data?.error_description || data?.error || `HTTP ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

loadEnv();

const email = process.env.DEMO_USER_EMAIL || "demo@propval.local";
const password = process.env.DEMO_USER_PASSWORD || "Demo123456!";
const regularEmail = process.env.TEST_USER_EMAIL || "user@propval.local";
const regularPassword = process.env.TEST_USER_PASSWORD || "User123456!";
const premiumEmail = process.env.PREMIUM_USER_EMAIL || "premium@propval.local";
const premiumPassword = process.env.PREMIUM_USER_PASSWORD || "Premium123456!";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

async function ensureUser({ email, password, metadata }) {
  try {
    const created = await supabaseFetch("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata,
      }),
    });
    console.log(`Created user: ${email}`);
    return created;
  } catch (error) {
    if (error.status !== 422 && !String(error.message).toLowerCase().includes("registered")) {
      throw error;
    }
    const users = await supabaseFetch("/auth/v1/admin/users?page=1&per_page=1000");
    const existing = users.users.find((item) => item.email === email);
    if (!existing) throw new Error(`User exists but could not be found: ${email}`);
    console.log(`User already exists: ${email}`);
    return existing;
  }
}

const user = await ensureUser({
  email,
  password,
  metadata: { plan: "free", seeded: true, role: "admin-demo" },
});

await ensureUser({
  email: regularEmail,
  password: regularPassword,
  metadata: { plan: "free", seeded: true, role: "user" },
});

await ensureUser({
  email: premiumEmail,
  password: premiumPassword,
  metadata: { plan: "premium", seeded: true, role: "premium-user" },
});

const sampleReport = {
  property: {
    address: "35 Abercrombie Pl",
    city: "Conroe",
    state: "TX",
    zip: "77384",
    type: "Single Family",
    baths: 2,
    sqft: 1619,
    yearBuilt: 2007,
  },
  zestimate: {
    value: 289300,
    rentEstimate: 2000,
    confidence: "medium",
    note: "Seeded demo valuation report.",
  },
  valuation: {
    low: 289300,
    mid: 289300,
    high: 289300,
    method: "Seeded demo valuation.",
  },
  analysis: {
    investmentScore: 50,
    verdict: "Demo report for onboarding.",
    strengths: ["Live property valuation report saved to this account."],
    risks: [],
    highlights: ["Property reference id: 87788805"],
    analystNote: "Apply supabase-schema.sql before expecting cloud history inserts to persist.",
  },
};

try {
  await supabaseFetch("/rest/v1/valuation_reports", {
    method: "POST",
    headers: { "Prefer": "return=minimal" },
    body: JSON.stringify({
      user_id: user.id,
      address: "35 Abercrombie Pl, Conroe, TX 77384",
      zpid: "87788805",
      zestimate: 289300,
      cma_mid: 289300,
      score: 50,
      report: sampleReport,
    }),
  });
  console.log("Inserted seeded valuation report.");
} catch (error) {
  console.warn(`Demo report was not inserted: ${error.message}`);
  console.warn("Apply supabase-schema.sql in Supabase SQL Editor, then run npm run seed again.");
}

console.log(`Sign in with ${email} / ${password}`);
console.log(`Regular user: ${regularEmail} / ${regularPassword}`);
console.log(`Premium user: ${premiumEmail} / ${premiumPassword}`);
