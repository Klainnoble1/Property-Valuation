import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabase } from "./src/supabaseClient.js";

// ── Storage keys ──────────────────────────────────────────────────────────────
const RK = "propval:rapidapi_key";
const HP = "propval:h:";

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt  = (n) => n != null && n !== 0 ? "$" + Number(n).toLocaleString() : "—";
const fmtK = (n) => !n ? "—" : n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n/1e3)}K` : fmt(n);
const cleanType = (t) => t ? t.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()) : "Residential";

const REHAB_STYLES = {
  none: {
    key: "none",
    label: "No renovations planned",
    shortLabel: "No Renovation",
    budget: [0, 0],
    timeline: "None",
    permits: "Not needed",
    risk: "Low",
    systems: "No construction or value-add work",
    summary: "No construction will take place, so the report should not create an after repair value.",
    scope: ["No rehab scope", "No value-add assumptions", "Current market value only"],
    excluded: ["After repair value", "Construction budget", "Renovation timeline"],
  },
  light: {
    key: "light",
    label: "Light and Cosmetic",
    shortLabel: "Light/Cosmetic",
    budget: [5000, 25000],
    timeline: "1-3 weeks",
    permits: "Usually not needed",
    risk: "Low",
    systems: "No major systems work",
    summary: "Low-cost, non-structural updates focused on appearance and marketability.",
    scope: ["Interior painting", "Minor drywall repair", "Flooring refresh", "Fixtures, appliances, counters", "Basic landscaping, cleaning, staging"],
    excluded: ["Electrical rewiring", "HVAC replacement", "Roof replacement", "Foundation repair", "Major layout changes", "Full kitchen or bathroom gut renovations"],
  },
  moderate: {
    key: "moderate",
    label: "Moderate Rehab",
    shortLabel: "Moderate",
    budget: [25000, 60000],
    timeline: "4-10 weeks",
    permits: "Sometimes needed",
    risk: "Moderate",
    systems: "Cosmetic plus partial systems",
    summary: "Mid-level renovation with cosmetic work and some functional repairs, but no full structural gut rehab.",
    scope: ["Kitchen and bathroom updates", "Partial plumbing or electrical", "Water heater or panel work", "Windows or doors", "Roof patching", "Flooring, trim, paint", "Minor non-load-bearing layout changes", "Exterior repair"],
    excluded: ["Foundation repair", "Whole-house rewiring", "Complete HVAC install", "Down-to-studs gut job", "Structural reconfiguration"],
  },
  fullGut: {
    key: "fullGut",
    label: "Full Gut Rehab",
    shortLabel: "Full Gut",
    budget: [70000, 200000],
    timeline: "3-9+ months",
    permits: "Always",
    risk: "High",
    systems: "Full replacement of major systems",
    summary: "Intensive renovation that may strip the property to studs and rebuild systems, finishes, and layout.",
    scope: ["Demo to studs", "New framing or floor plan changes", "Full electrical, plumbing, HVAC", "New insulation and drywall", "New kitchen and bathrooms", "Roof, siding, windows, or structural repairs if needed", "All new fixtures and finishes"],
    excluded: ["Unpermitted trades", "Underfunded scope", "ARV assumptions without supporting renovated comps"],
  },
};

const DEFAULT_REHAB_KEY = "none";

function rehabProfile(key) {
  return REHAB_STYLES[key] || REHAB_STYLES[DEFAULT_REHAB_KEY];
}

// ── Property data API ─────────────────────────────────────────────────────────
const RAPIDAPI_HOST = "real-time-real-estate-data.p.rapidapi.com";
const RAPIDAPI_BASE = "/api/rapidapi";

async function readRapidApiJson(res, label) {
  const json = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw new Error(json?.error || "Property data provider is not configured. Please check server environment settings.");
  if (res.status === 429) throw new Error("Property data limit reached. Please wait and try again.");
  if (!res.ok) throw new Error(json?.error || `${label} error (${res.status})`);
  if (json?.status && json.status !== "OK" && json.status !== "success") {
    throw new Error(json.error?.message || json.message || `${label} returned ${json.status}`);
  }
  return json?.data ?? json;
}

function firstProperty(data) {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  if (Array.isArray(data.results)) return data.results[0] ?? null;
  if (Array.isArray(data.props)) return data.props[0] ?? null;
  if (Array.isArray(data.propertyResults)) return data.propertyResults[0] ?? null;
  if (Array.isArray(data.listResults)) return data.listResults[0] ?? null;
  if (Array.isArray(data.properties)) return data.properties[0] ?? null;
  if (Array.isArray(data.homes)) return data.homes[0] ?? null;
  if (data.propertyDetails) return data.propertyDetails;
  if (data.home) return data.home;
  if (data.property) return data.property;
  return data;
}

function lookupValue(source, keys) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const value = source[key];
    if (value != null && value !== "") return value;
  }
  for (const key of ["property", "propertyDetails", "home", "detail", "hdpData", "zillowProperty"]) {
    const value = lookupValue(source[key], keys);
    if (value != null && value !== "") return value;
  }
  return null;
}

function propertyLookupId(...sources) {
  const keys = ["zpid", "zillowPropertyId", "propertyZpid", "property_id", "propertyId", "id"];
  for (const source of sources) {
    const value = lookupValue(source, keys);
    if (value != null && value !== "") return value;
  }
  return null;
}

function imageUrlFromValue(value) {
  if (!value) return null;
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  if (typeof value !== "object") return null;
  return value.url || value.href || value.src || value.imgSrc || value.mixedSources?.jpeg?.[0]?.url || value.mixedSources?.webp?.[0]?.url || null;
}

function collectPropertyPhotos(source, limit = 12, seen = new Set()) {
  if (!source || seen.size >= limit) return [];
  const photos = [];
  const add = (value) => {
    const url = imageUrlFromValue(value);
    if (url && !seen.has(url)) {
      seen.add(url);
      photos.push(url);
    }
  };

  if (Array.isArray(source)) {
    source.forEach((item) => {
      if (photos.length < limit) {
        if (typeof item === "string") add(item);
        else photos.push(...collectPropertyPhotos(item, limit - photos.length, seen));
      }
    });
    return photos.slice(0, limit);
  }

  if (typeof source !== "object") return photos;
  ["imgSrc", "image", "imageUrl", "photo", "photoUrl", "hiResImageLink", "mediumImageLink", "miniCardPhotos"].forEach((key) => add(source[key]));
  ["photos", "propertyPhotos", "responsivePhotos", "carouselPhotos", "images", "media", "listingPhotos"].forEach((key) => {
    if (photos.length < limit) photos.push(...collectPropertyPhotos(source[key], limit - photos.length, seen));
  });
  ["property", "propertyDetails", "home", "detail", "summary", "hdpData", "zillowProperty"].forEach((key) => {
    if (photos.length < limit) photos.push(...collectPropertyPhotos(source[key], limit - photos.length, seen));
  });
  return photos.slice(0, limit);
}

function zestimateValues(data) {
  const src = data?.data ?? data ?? {};
  return {
    zestimate: src.zestimate ?? src.property?.zestimate ?? src.valuation?.zestimate,
    rentZestimate: src.rentZestimate ?? src.rent_zestimate ?? src.rentEstimate ?? src.property?.rentZestimate,
    zestimateLowPercent: src.zestimateLowPercent ?? src.zestimate_low_percent,
    zestimateHighPercent: src.zestimateHighPercent ?? src.zestimate_high_percent,
    restimateLowPercent: src.restimateLowPercent ?? src.restimate_low_percent,
    restimateHighPercent: src.restimateHighPercent ?? src.restimate_high_percent,
  };
}

async function getJson(path, params, label) {
  const url = new URL(RAPIDAPI_BASE, window.location.origin);
  url.searchParams.set("path", path);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString());
  return readRapidApiJson(res, label);
}

async function fetchZillow(address) {
  let detail = null;
  let summary = null;

  try {
    detail = firstProperty(await getJson("/property-details-address", { address }, "Property by address"));
  } catch (e) {
    const search = await getJson("/search", { location: address }, "Property search");
    summary = firstProperty(search);
    const summaryId = propertyLookupId(summary);
    if (!summaryId) throw new Error("Property not found. Try a more complete address (include city, state).");
    try {
      detail = firstProperty(await getJson("/property-details", { zpid: summaryId }, "Property details"));
    } catch {
      detail = summary;
    }
  }

  const zpid = propertyLookupId(detail, summary);
  if (!detail && !summary) throw new Error("Property not found. Try a more complete address (include city, state).");

  let estimate = {};
  if (zpid) {
    try {
      estimate = zestimateValues(await getJson("/zestimate", { zpid }, "Valuation estimate"));
    } catch (e) {
      estimate = zestimateValues(detail);
    }
  } else {
    estimate = zestimateValues(detail);
  }

  const mergedDetail = { ...detail, ...estimate };
  return { zpid: zpid ? String(zpid) : null, summary: summary ?? detail, detail: mergedDetail };
}

// ── OpenAI analysis ───────────────────────────────────────────────────────────
function buildAnalysisPrompt(address, zillow) {
  const d = zillow?.detail;
  const zest     = d?.zestimate     ?? zillow?.summary?.zestimate;
  const rentZest = d?.rentZestimate ?? zillow?.summary?.rentZestimate;
  const zLow     = zest && d?.zestimateLowPercent  ? Math.round(zest * (1 - parseFloat(d.zestimateLowPercent)/100))  : null;
  const zHigh    = zest && d?.zestimateHighPercent ? Math.round(zest * (1 + parseFloat(d.zestimateHighPercent)/100)) : null;

  const zBlock = d ? `
ZILLOW DATA (treat as ground truth for property facts):
  Address    : ${d.address?.streetAddress}, ${d.address?.city}, ${d.address?.state} ${d.address?.zipcode}
  Type       : ${d.homeType}
  Status     : ${d.homeStatus}
  Beds/Baths : ${d.bedrooms} bd / ${d.bathrooms} ba
  Living Area: ${d.livingArea} sqft
  Lot Size   : ${d.lotAreaValue} ${d.lotAreaUnit || "sqft"}
  Year Built : ${d.yearBuilt}
  List Price : ${d.price ? "$"+Number(d.price).toLocaleString() : "N/A"}
  Last Sold  : ${d.lastSoldPrice ? "$"+Number(d.lastSoldPrice).toLocaleString() : "?"} on ${d.dateSold || "?"}
  Estimate   : $${Number(zest||0).toLocaleString()} (range ${d.zestimateLowPercent||"?"}% to +${d.zestimateHighPercent||"?"}%)
  Rent Est.  : $${Number(rentZest||0).toLocaleString()}/mo
  Price Hist : ${JSON.stringify((d.priceHistory||[]).slice(0,5))}
  Tax History: ${JSON.stringify((d.taxHistory||[]).slice(0,3))}
  Garage     : ${d.resoFacts?.hasGarage ?? "?"}
  Pool       : ${d.resoFacts?.hasPrivatePool ?? "?"}
  Stories    : ${d.resoFacts?.stories ?? "?"}
` : `No provider data. Use web search to find all property details.`;

  return `You are an expert real estate CMA analyst.

Property: "${address}"
${zBlock}

Task: Use web search to find 3–5 comparable sold properties (same type, similar size/beds/baths, within 1 mile, sold last 6–12 months). Also gather local market statistics for this ZIP/neighborhood.

${d ? "Do NOT re-fetch the property's own details; use the data above. Focus web searches on COMPARABLE SALES and MARKET DATA." : "Use web search to find property details plus comparable sales."}

Return ONLY raw JSON — no markdown fences, no explanation:
{
  "property": {
    "address": "full", "city": "", "state": "", "zip": "",
    "neighborhood": "",
    "type": "${d?.homeType ? cleanType(d.homeType) : ""}",
    "beds": ${d?.bedrooms ?? 0},
    "baths": ${d?.bathrooms ?? 0},
    "sqft": ${d?.livingArea ?? 0},
    "lotSqft": ${d?.lotAreaValue ?? 0},
    "yearBuilt": ${d?.yearBuilt ?? 0},
    "listPrice": ${d?.price ?? null},
    "lastSalePrice": ${d?.lastSoldPrice ?? null},
    "lastSaleDate": "${d?.dateSold ?? ""}",
    "taxAssessedValue": ${d?.taxHistory?.[0]?.value ?? null},
    "pricePerSqft": ${d?.livingArea && d?.price ? Math.round(d.price/d.livingArea) : null},
    "daysOnMarket": ${d?.daysOnZillow ?? null},
    "garage": ${d?.resoFacts?.hasGarage ?? false},
    "pool": ${d?.resoFacts?.hasPrivatePool ?? false},
    "stories": ${d?.resoFacts?.stories ?? 1},
    "description": ""
  },
  "zestimate": {
    "value": ${zest ?? null},
    "low": ${zLow ?? null},
    "high": ${zHigh ?? null},
    "rentEstimate": ${rentZest ?? null},
    "zestimateLowPct": "${d?.zestimateLowPercent ?? ""}",
    "zestimateHighPct": "${d?.zestimateHighPercent ?? ""}",
    "confidence": "high",
    "note": "Brief note on automated estimate reliability for this property type and area"
  },
  "priceHistory": [
    { "date": "YYYY-MM-DD", "price": 0, "event": "Sold|Listed|Delisted|Price Change", "source": "" }
  ],
  "market": {
    "medianSalePrice": 0,
    "medianPricePerSqft": 0,
    "avgDaysOnMarket": 0,
    "listToSaleRatio": 0.98,
    "trend": "appreciating",
    "trendPct": 0.0,
    "trendNote": "",
    "inventory": "low",
    "inventoryNote": ""
  },
  "comps": [{
    "address": "", "salePrice": 0, "beds": 0, "baths": 0, "sqft": 0,
    "pricePerSqft": 0, "soldDate": "", "distance": "",
    "similarity": "high", "adjustments": ""
  }],
  "valuation": {
    "low": 0, "mid": 0, "high": 0,
    "pricePerSqftRange": "",
    "zestimateDelta": null,
    "method": "Sales comparison approach — N comps weighted by recency and similarity"
  },
  "analysis": {
    "investmentScore": 72,
    "verdict": "",
    "vsZestimate": null,
    "vsListPrice": null,
    "vsLastSale": null,
    "vsMedian": null,
    "strengths": [],
    "risks": [],
    "highlights": [],
    "analystNote": ""
  }
}`;
}

async function runOpenAI(address, zillow) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: buildAnalysisPrompt(address, zillow),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || `OpenAI analysis error (${res.status})`);
  }
  const data = await res.json();
  const text = data.text || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Could not parse analysis. Try again.");
  return JSON.parse(match[0]);
}

function buildBasicAnalysis(address, zillow, analysisError) {
  const d = zillow?.detail ?? {};
  const addr = typeof d.address === "object" ? d.address : {};
  const zest = d.zestimate ?? zillow?.summary?.zestimate ?? null;
  const rentZest = d.rentZestimate ?? zillow?.summary?.rentZestimate ?? null;
  const low = zest && d.zestimateLowPercent ? Math.round(zest * (1 - parseFloat(d.zestimateLowPercent) / 100)) : null;
  const high = zest && d.zestimateHighPercent ? Math.round(zest * (1 + parseFloat(d.zestimateHighPercent) / 100)) : null;
  const street = addr.streetAddress || d.streetAddress || d.address || address;
  const city = addr.city || d.city || "";
  const state = addr.state || d.state || "";
  const zip = addr.zipcode || addr.zipCode || d.zipcode || d.zipCode || "";
  const price = d.price ?? d.listPrice ?? null;
  const sqft = d.livingArea ?? d.livingAreaValue ?? d.sqft ?? null;
  const mid = zest ?? price ?? null;

  return {
    property: {
      address: street,
      city,
      state,
      zip,
      neighborhood: d.neighborhood || d.subdivision || "",
      type: cleanType(d.homeType || d.propertyType),
      beds: d.bedrooms ?? d.beds ?? 0,
      baths: d.bathrooms ?? d.baths ?? 0,
      sqft: sqft ?? 0,
      lotSqft: d.lotAreaValue ?? d.lotSize ?? 0,
      yearBuilt: d.yearBuilt ?? 0,
      listPrice: price,
      lastSalePrice: d.lastSoldPrice ?? d.lastSalePrice ?? null,
      lastSaleDate: d.dateSold ?? d.lastSoldDate ?? "",
      taxAssessedValue: d.taxHistory?.[0]?.value ?? null,
      pricePerSqft: sqft && price ? Math.round(price / sqft) : null,
      daysOnMarket: d.daysOnZillow ?? d.daysOnMarket ?? null,
      garage: d.resoFacts?.hasGarage ?? false,
      pool: d.resoFacts?.hasPrivatePool ?? false,
      stories: d.resoFacts?.stories ?? 1,
      description: d.description || "",
    },
    zestimate: {
      value: zest,
      low,
      high,
      rentEstimate: rentZest,
      zestimateLowPct: d.zestimateLowPercent ?? "",
      zestimateHighPct: d.zestimateHighPercent ?? "",
      confidence: zest ? "medium" : "low",
      note: analysisError ? `Live property estimate loaded. CMA analysis is currently limited: ${analysisError.message}` : "Live property estimate loaded.",
    },
    priceHistory: (d.priceHistory || []).slice(0, 8),
    market: {},
    comps: [],
    valuation: {
      low: low ?? mid,
      mid,
      high: high ?? mid,
      pricePerSqftRange: sqft && mid ? `$${Math.round((low ?? mid) / sqft)}-$${Math.round((high ?? mid) / sqft)}/sqft` : "",
      zestimateDelta: null,
      method: "Automated estimate fallback. Full CMA requires the AI analysis service to be available from the app backend.",
    },
    analysis: {
      investmentScore: 50,
      verdict: "Property estimate loaded. Add backend AI analysis to produce comps, market context, and a full CMA.",
      vsZestimate: null,
      vsListPrice: null,
      vsLastSale: null,
      vsMedian: null,
      strengths: zest ? ["Live property estimate returned successfully."] : [],
      risks: ["Comparable sales and market context were not generated because the AI analysis service was unavailable."],
      highlights: zillow?.zpid ? [`Property reference id: ${zillow.zpid}`] : [],
      analystNote: "This fallback report confirms the live property data integration. AI analysis runs through the local backend endpoint when an active provider key is configured.",
    },
  };
}

function applyRehabToReport(report, rehabStyle) {
  if (!report) return report;
  const rehab = rehabProfile(rehabStyle);
  const valuation = report.valuation || {};
  const baseValue = valuation.mid || report.zestimate?.value || valuation.high || null;
  const arv = rehab.key === "none" ? null : valuation.afterRepairValue || valuation.arv || valuation.high || baseValue;

  return {
    ...report,
    rehab: {
      styleKey: rehab.key,
      label: rehab.label,
      summary: rehab.summary,
      budgetLow: rehab.budget[0],
      budgetHigh: rehab.budget[1],
      timeline: rehab.timeline,
      permits: rehab.permits,
      risk: rehab.risk,
      systems: rehab.systems,
      afterRepairValue: arv,
      arvNote: rehab.key === "none"
        ? "No ARV because no renovation or repair is planned."
        : "Scenario ARV uses the current valuation range until renovated comps are generated in a full CMA.",
      scopeItems: rehab.scope,
      excludedItems: rehab.excluded,
    },
  };
}

function stripRehab(report) {
  if (!report) return report;
  const { rehab, ...baseReport } = sanitizeLegacyReport(report);
  return baseReport;
}

function sanitizeLegacyReport(value) {
  if (Array.isArray(value)) return value.map(sanitizeLegacyReport);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeLegacyReport(item)]));
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/Zestimate-style/gi, "property valuation")
    .replace(/Zestimate/gi, "estimate")
    .replace(/Zillow property id/gi, "Property reference id")
    .replace(/Zillow/gi, "property data provider");
}

async function sessionToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

async function fetchCachedAnalysis(address) {
  const token = await sessionToken();
  if (!token) return null;
  const url = new URL("/api/property-cache", window.location.origin);
  url.searchParams.set("address", address);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const payload = await res.json();
  return payload.cache || null;
}

async function saveCachedAnalysis({ address, zpid, report, zillowRaw }) {
  const token = await sessionToken();
  if (!token) return;
  await fetch("/api/property-cache", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ address, zpid, report: stripRehab(report), zillowRaw }),
  }).catch(() => null);
}

// ── Steps ─────────────────────────────────────────────────────────────────────
const STEPS = [
  { label: "Checking saved property analysis…",   key: "cache"   },
  { label: "Fetching valuation signals…",         key: "zillow2" },
  { label: "Scanning comparable sales nearby…",   key: "comps"   },
  { label: "Running comparative market analysis…",key: "cma"     },
  { label: "Compiling valuation report…",         key: "report"  },
];

// ── UI helpers ────────────────────────────────────────────────────────────────
function Badge({ children, tone = "neutral", sm }) {
  const tones = {
    green:   ["rgba(100,200,120,.13)","#64c878","rgba(100,200,120,.3)"],
    gold:    ["rgba(201,168,76,.13)","#c9a84c","rgba(201,168,76,.3)"],
    red:     ["rgba(224,112,96,.13)","#e07060","rgba(224,112,96,.3)"],
    neutral: ["rgba(255,255,255,.05)","#9a9080","rgba(255,255,255,.1)"],
    blue:    ["rgba(100,160,240,.13)","#80a8f0","rgba(100,160,240,.3)"],
  };
  const [bg,color,border] = tones[tone]||tones.neutral;
  return <span style={{ fontSize: sm?9:11, padding: sm?"2px 6px":"3px 10px", borderRadius:20, background:bg, color, border:`1px solid ${border}`, fontFamily:"sans-serif", whiteSpace:"nowrap" }}>{children}</span>;
}

function Divider() { return <div style={{ height:1, background:"#1a1c22", margin:"2px 0" }} />; }

function Row({ label, value, right, sub, last }) {
  return (
    <>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"11px 0" }}>
        <div>
          <div style={{ fontSize:13, color:"#b0a898", fontFamily:"sans-serif" }}>{label}</div>
          {sub && <div style={{ fontSize:10, color:"#4a4840", fontFamily:"sans-serif", marginTop:2 }}>{sub}</div>}
        </div>
        {right || <div style={{ fontSize:14, color:"#f0e8d8", fontFamily:"sans-serif" }}>{value}</div>}
      </div>
      {!last && <Divider />}
    </>
  );
}

function ScoreArc({ score }) {
  const r=54, cx=70, cy=70, circ=Math.PI*r;
  const filled=(score/100)*circ;
  const color=score>=70?"#64c878":score>=45?"#c9a84c":"#e07060";
  const label=score>=70?"Strong Buy":score>=55?"Fair Value":score>=40?"Caution":"Overpriced";
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
      <svg width="140" height="80" viewBox="0 0 140 80">
        <path d={`M${cx-r} ${cy} A${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke="#1e2028" strokeWidth="10" strokeLinecap="round"/>
        <path d={`M${cx-r} ${cy} A${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${filled} ${circ}`} style={{ filter:`drop-shadow(0 0 6px ${color}80)` }}/>
        <text x={cx} y={cy-6} textAnchor="middle" fill={color} fontSize="22" fontFamily="Georgia,serif" fontWeight="bold">{score}</text>
        <text x={cx} y={cy+10} textAnchor="middle" fill="#5a5850" fontSize="9" fontFamily="sans-serif" letterSpacing="1">/100</text>
      </svg>
      <div style={{ fontSize:12, color, fontFamily:"sans-serif", marginTop:-4 }}>{label}</div>
    </div>
  );
}

function ValuationMeter({ value, low, high }) {
  if (!value) return null;
  const range = (high||value*1.06) - (low||value*0.94);
  const mid = (value - (low||value*0.94)) / (range||1);
  const pct = Math.min(95, Math.max(5, mid*100));
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#5a5850", fontFamily:"sans-serif", marginBottom:5 }}>
        <span>{fmtK(low)}</span><span style={{ color:"#c9a84c" }}>Estimate</span><span>{fmtK(high)}</span>
      </div>
      <div style={{ position:"relative", height:8, background:"#1a1c22", borderRadius:6 }}>
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(90deg,#1a2a1a,rgba(201,168,76,.35),#2a1a1a)", borderRadius:6 }}/>
        <div style={{ position:"absolute", top:-4, left:`${pct}%`, transform:"translateX(-50%)", width:16, height:16, borderRadius:"50%", background:"#c9a84c", border:"2px solid #0c0e13", boxShadow:"0 0 10px rgba(201,168,76,.6)", zIndex:2 }}/>
      </div>
    </div>
  );
}

function PriceTimeline({ history }) {
  if (!history?.length) return null;
  const sorted = [...history].sort((a,b) => new Date(a.date)-new Date(b.date));
  const eventColor = (e) => e==="Sold"?"#64c878":e?.includes("Price")?"#c9a84c":"#6080c0";
  return (
    <div style={{ position:"relative", paddingLeft:20 }}>
      <div style={{ position:"absolute", left:7, top:0, bottom:0, width:1, background:"#1e2028" }}/>
      {sorted.map((h,i) => (
        <div key={i} style={{ position:"relative", paddingBottom:14, paddingLeft:16 }}>
          <div style={{ position:"absolute", left:-6, top:4, width:10, height:10, borderRadius:"50%", background:eventColor(h.event), border:"2px solid #0c0e13", boxShadow:`0 0 6px ${eventColor(h.event)}60` }}/>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <span style={{ fontSize:13, color:"#d0c8b8", fontFamily:"sans-serif" }}>{h.event}</span>
              {h.source && <span style={{ fontSize:10, color:"#4a4840", fontFamily:"sans-serif", marginLeft:6 }}>via {h.source}</span>}
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:14, color:eventColor(h.event), fontFamily:"sans-serif" }}>{h.price ? fmtK(h.price) : "—"}</div>
              <div style={{ fontSize:10, color:"#4a4840", fontFamily:"sans-serif" }}>{h.date?.slice(0,10)}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Settings Modal ─────────────────────────────────────────────────────────────
function RehabSelector({ value, onChange }) {
  return (
    <div style={{ background:"#13161d", border:"1px solid #222530", borderRadius:12, padding:"14px", marginBottom:16 }}>
      <div style={{ fontSize:10, letterSpacing:"2px", textTransform:"uppercase", color:"#c9a84c", fontFamily:"sans-serif", marginBottom:3 }}>Rehab Style</div>
      <div style={{ fontSize:12, color:"#6a6258", fontFamily:"sans-serif", marginBottom:10 }}>Choose the renovation scope before running the valuation.</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:8 }}>
        {Object.values(REHAB_STYLES).map((style) => {
          const active = value === style.key;
          return (
            <button
              key={style.key}
              onClick={() => onChange(style.key)}
              type="button"
              style={{
                textAlign:"left",
                border:active ? "1px solid rgba(201,168,76,.65)" : "1px solid #222530",
                background:active ? "rgba(201,168,76,.1)" : "#0d0f14",
                borderRadius:9,
                padding:"10px 11px",
                cursor:"pointer",
                minHeight:88,
              }}
            >
              <div style={{ color:active ? "#e8c97a" : "#f0e8d8", fontSize:12, fontFamily:"sans-serif", fontWeight:"bold", marginBottom:6 }}>{style.shortLabel}</div>
              <div style={{ color:"#6a6258", fontSize:10, fontFamily:"sans-serif", lineHeight:1.45 }}>{style.timeline} / {style.risk} risk</div>
              <div style={{ color:"#4a4840", fontSize:10, fontFamily:"sans-serif", marginTop:5 }}>
                {style.budget[1] ? `${fmtK(style.budget[0])}-${fmtK(style.budget[1])}` : "No ARV"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RehabSummary({ rehab }) {
  if (!rehab) return null;
  const hasBudget = Number(rehab.budgetHigh) > 0;
  return (
    <div style={{ background:"#13161d", border:"1px solid #222530", borderRadius:14, padding:"22px 24px", marginBottom:14 }}>
      <SectionLabel>Rehab Scope</SectionLabel>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:16, marginBottom:12 }}>
        <div>
          <div style={{ fontSize:19, color:"#f0e8d8", marginBottom:5 }}>{rehab.label}</div>
          <div style={{ fontSize:12, color:"#6a6258", fontFamily:"sans-serif", lineHeight:1.6 }}>{rehab.summary}</div>
        </div>
        <Badge tone={rehab.risk === "High" ? "red" : rehab.risk === "Moderate" ? "gold" : "green"}>{rehab.risk} Risk</Badge>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))", gap:8, marginBottom:14 }}>
        <MiniStat label="Budget" value={hasBudget ? `${fmtK(rehab.budgetLow)}-${fmtK(rehab.budgetHigh)}` : "None"} />
        <MiniStat label="Timeline" value={rehab.timeline} />
        <MiniStat label="Permits" value={rehab.permits} />
        <MiniStat label="ARV" value={rehab.afterRepairValue ? fmtK(rehab.afterRepairValue) : "Not applicable"} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:12 }}>
        <ListBlock title="Included Scope" items={rehab.scopeItems} color="#64c878" />
        <ListBlock title="Not Included" items={rehab.excludedItems} color="#e07060" />
      </div>
      {rehab.arvNote && <div style={{ marginTop:12, fontSize:11, color:"#4a4840", fontFamily:"sans-serif", fontStyle:"italic" }}>{rehab.arvNote}</div>}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div style={{ background:"#0d0f14", border:"1px solid #1a1c22", borderRadius:10, padding:"11px 12px" }}>
      <div style={{ fontSize:9, color:"#4a4840", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>{label}</div>
      <div style={{ fontSize:13, color:"#f0e8d8", fontFamily:"sans-serif" }}>{value || "—"}</div>
    </div>
  );
}

function ListBlock({ title, items = [], color }) {
  return (
    <div style={{ background:"#0d0f14", border:"1px solid #1a1c22", borderRadius:10, padding:"12px 14px" }}>
      <div style={{ fontSize:9, color:"#4a4840", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>{title}</div>
      {(items || []).slice(0, 7).map((item, i) => (
        <div key={i} style={{ display:"flex", gap:7, alignItems:"flex-start", fontSize:11, color:"#b0a898", fontFamily:"sans-serif", lineHeight:1.45, marginBottom:5 }}>
          <span style={{ color, lineHeight:1.45 }}>-</span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function PhotoGallery({ photos = [] }) {
  if (!photos.length) return null;
  return (
    <div style={{ background:"#13161d", border:"1px solid #222530", borderRadius:14, padding:"14px", marginBottom:14 }}>
      <div className="photo-grid" style={{ display:"grid", gridTemplateColumns:photos.length > 1 ? "minmax(0,1.35fr) minmax(180px,.65fr)" : "1fr", gap:8 }}>
        <div style={{ aspectRatio:"16/10", overflow:"hidden", borderRadius:10, background:"#0d0f14" }}>
          <img src={photos[0]} alt="Property exterior" loading="lazy" referrerPolicy="no-referrer" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
        </div>
        {photos.length > 1 && <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:8 }}>
          {photos.slice(1, 5).map((photo, index) => (
            <div key={photo} style={{ aspectRatio:"1/1", overflow:"hidden", borderRadius:9, background:"#0d0f14", position:"relative" }}>
              <img src={photo} alt={`Property photo ${index + 2}`} loading="lazy" referrerPolicy="no-referrer" style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }} />
              {index === 3 && photos.length > 5 && (
                <div style={{ position:"absolute", inset:0, background:"rgba(12,14,19,.62)", display:"flex", alignItems:"center", justifyContent:"center", color:"#f0e8d8", fontFamily:"sans-serif", fontSize:13, fontWeight:"bold" }}>
                  +{photos.length - 5}
                </div>
              )}
            </div>
          ))}
        </div>}
      </div>
    </div>
  );
}

function SettingsModal({ onClose, user, theme, setTheme, onSignOut }) {
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || user?.user_metadata?.name || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const joined = user?.created_at ? new Date(user.created_at).toLocaleDateString() : "—";
  const lastSignIn = user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "—";
  const plan = user?.user_metadata?.plan || user?.app_metadata?.plan || "Free";
  const light = theme === "light";
  const settingsPalette = {
    overlay: light ? "rgba(32,27,20,.42)" : "rgba(0,0,0,.7)",
    panel: light ? "#ffffff" : "#13161d",
    panelBorder: light ? "#ded6c8" : "#2a2830",
    title: light ? "#201b14" : "#f0e8d8",
    muted: light ? "#6d6254" : "#5a5850",
    inputBg: light ? "#fbf8f2" : "#0d0f14",
    inputBorder: light ? "#d8cebd" : "#2a2830",
    softBg: light ? "#fbf8f2" : "rgba(201,168,76,.05)",
    softBorder: light ? "#eadfcf" : "rgba(201,168,76,.15)",
    text: light ? "#31291f" : "#d8d0c0",
    dangerBg: light ? "#fff7f5" : "#0d0f14",
  };

  async function saveProfile() {
    setSaving(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName.trim(), name: fullName.trim() },
      });
      if (error) throw error;
      setMessage("Settings saved.");
    } catch (err) {
      setMessage(err.message || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div style={{ position:"fixed", inset:0, background:settingsPalette.overlay, zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={onClose}>
      <div style={{ background:settingsPalette.panel, border:`1px solid ${settingsPalette.panelBorder}`, borderRadius:16, padding:28, width:"100%", maxWidth:540, boxShadow:light ? "0 24px 70px rgba(60,45,20,.18)" : "none" }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div>
            <div style={{ fontSize:16, color:settingsPalette.title }}>User Settings</div>
            <div style={{ fontSize:11, color:settingsPalette.muted, fontFamily:"sans-serif", marginTop:3 }}>{user?.email}</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#5a5850", cursor:"pointer", fontSize:18 }}>✕</button>
        </div>

        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11, color:"#c9a84c", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Profile</div>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            type="text"
            placeholder="Full name"
            style={{ width:"100%", background:settingsPalette.inputBg, border:`1px solid ${settingsPalette.inputBorder}`, borderRadius:9, padding:"11px 14px", color:settingsPalette.title, fontSize:14, fontFamily:"sans-serif", outline:"none", boxSizing:"border-box" }}
            onFocus={e=>e.target.style.borderColor="#c9a84c"}
            onBlur={e=>e.target.style.borderColor=settingsPalette.inputBorder}
          />
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10, marginBottom:18 }}>
          <MiniStat label="Plan" value={plan} />
          <MiniStat label="Theme" value={theme === "dark" ? "Dark" : "Light"} />
          <MiniStat label="Joined" value={joined} />
          <MiniStat label="Last sign in" value={lastSignIn} />
        </div>

        <div style={{ background:settingsPalette.softBg, border:`1px solid ${settingsPalette.softBorder}`, borderRadius:10, padding:"12px 14px", marginBottom:18 }}>
          <div style={{ color:"#9b7624", marginBottom:10, fontWeight:"bold", fontSize:11, fontFamily:"sans-serif" }}>Preferences</div>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            style={{ width:"100%", padding:"10px 12px", background:settingsPalette.inputBg, border:`1px solid ${settingsPalette.inputBorder}`, borderRadius:9, color:settingsPalette.text, fontFamily:"sans-serif", cursor:"pointer", textAlign:"left" }}
          >
            Switch to {theme === "dark" ? "light" : "dark"} mode
          </button>
        </div>

        <div style={{ display:"flex", gap:8 }}>
          <button onClick={saveProfile} disabled={saving} style={{ flex:1, padding:"11px", background:"linear-gradient(135deg,#c9a84c,#e8c97a)", border:"none", borderRadius:9, color:"#0c0e13", fontFamily:"sans-serif", fontWeight:"bold", fontSize:13, cursor:"pointer" }}>
            {saving ? "Saving..." : "Save settings"}
          </button>
          <button onClick={onSignOut} style={{ padding:"11px 14px", background:settingsPalette.dangerBg, border:"1px solid rgba(224,112,96,.35)", borderRadius:9, color:"#b84c3d", fontFamily:"sans-serif", fontWeight:"bold", fontSize:13, cursor:"pointer" }}>
            Sign out
          </button>
        </div>

        {message && <div style={{ marginTop:14, fontSize:11, color:message.includes("saved") ? "#64c878" : "#e07060", fontFamily:"sans-serif", textAlign:"center" }}>{message}</div>}
      </div>
    </div>,
    document.body
  );
}

// ── History Panel ─────────────────────────────────────────────────────────────
function HistoryPanel({ onClose, onLoad, user }) {
  const [items, setItems] = useState([]);
  useEffect(() => { loadItems(); }, []);
  async function loadItems() {
    try {
      let cloud = [];
      if (supabase && user?.id) {
        const { data } = await supabase
          .from("valuation_reports")
          .select("id, address, zestimate, cma_mid, score, zpid, report, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(25);
        cloud = (data || []).map((row) => ({
          id: row.id,
          cloud: true,
          savedAt: new Date(row.created_at).getTime(),
          address: row.address,
          zestimate: row.zestimate,
          cmaMid: row.cma_mid,
          score: row.score,
          zpid: row.zpid,
          report: row.report,
        }));
      }
      const r = await window.storage.list(HP);
      if (!r?.keys?.length) { setItems(cloud); return; }
      const all = await Promise.all(r.keys.map(async k => {
        try { const v = await window.storage.get(k); return v ? JSON.parse(v.value) : null; } catch { return null; }
      }));
      setItems([...cloud, ...all.filter(Boolean)].sort((a,b) => b.savedAt - a.savedAt));
    } catch {}
  }
  async function remove(id) {
    try {
      if (supabase && user?.id && !String(id).startsWith(HP)) {
        await supabase.from("valuation_reports").delete().eq("id", id).eq("user_id", user.id);
      } else {
        await window.storage.delete(id);
      }
      loadItems();
    } catch {}
  }
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.65)", zIndex:100, display:"flex", justifyContent:"flex-end" }} onClick={onClose}>
      <div style={{ width:"min(100vw,380px)", background:"#0d0f14", borderLeft:"1px solid #1e2028", height:"100%", overflowY:"auto", padding:24, boxSizing:"border-box" }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontSize:15, color:"#f0e8d8" }}>Search History</div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"#5a5850", cursor:"pointer", fontSize:18 }}>✕</button>
        </div>
        {!items.length ? (
          <div style={{ textAlign:"center", color:"#3a3830", fontFamily:"sans-serif", fontSize:13, padding:"40px 0" }}>No saved searches yet</div>
        ) : items.map((it,i) => (
          <div key={i} style={{ background:"#13161d", border:"1px solid #1e2028", borderRadius:12, padding:"14px 16px", marginBottom:10, cursor:"pointer" }} onClick={() => { onLoad(it); onClose(); }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
              <div style={{ fontSize:13, color:"#d0c8b8", fontFamily:"sans-serif", flex:1, paddingRight:8 }}>{it.address}</div>
              <button onClick={e=>{ e.stopPropagation(); remove(it.id); }} style={{ background:"none", border:"none", color:"#3a3830", cursor:"pointer", fontSize:14, flexShrink:0 }}>✕</button>
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:6 }}>
              {it.zestimate && <Badge tone="gold">Estimate: {fmtK(it.zestimate)}</Badge>}
              {it.cmaMid    && <Badge tone="neutral">CMA: {fmtK(it.cmaMid)}</Badge>}
              {it.score     && <Badge tone={it.score>=70?"green":it.score>=45?"gold":"red"}>Score {it.score}/100</Badge>}
              {(it.rehabStyle || it.report?.rehab?.label) && <Badge tone="blue">{it.rehabStyle || it.report.rehab.label}</Badge>}
            </div>
            <div style={{ fontSize:10, color:"#3a3830", fontFamily:"sans-serif" }}>{new Date(it.savedAt).toLocaleDateString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────────
export default function App({ user, theme = "dark", setTheme = () => {}, onSignOut = () => {} }) {
  const [query,       setQuery]       = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("address") || "";
  });
  const [apiKey,      setApiKey]      = useState("server-env");
  const [rehabStyle,  setRehabStyle]  = useState(DEFAULT_REHAB_KEY);
  const [loading,     setLoading]     = useState(false);
  const [step,        setStep]        = useState(0);
  const [baseResult,  setBaseResult]  = useState(null);
  const [result,      setResult]      = useState(null);
  const [zillowRaw,   setZillowRaw]   = useState(null);
  const [propertyPhotos, setPropertyPhotos] = useState([]);
  const [error,       setError]       = useState(null);
  const [showSettings,setShowSettings]= useState(false);
  const [showHistory, setShowHistory] = useState(false);

  function hydratePhotos(raw) {
    setPropertyPhotos([]);
    if (!raw) return;
    const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 1));
    schedule(() => setPropertyPhotos(collectPropertyPhotos(raw)));
  }

  async function saveSearchRecord(displayAnalysis, zpid, raw = zillowRaw) {
    const entry = {
      id: `${HP}${Date.now()}`,
      savedAt: Date.now(),
      address: displayAnalysis.property?.address || query,
      zestimate: displayAnalysis.zestimate?.value,
      cmaMid: displayAnalysis.valuation?.mid,
      score: displayAnalysis.analysis?.investmentScore,
      zpid,
      rehabStyle: displayAnalysis.rehab?.label,
      report: displayAnalysis,
      zillowRaw: raw,
    };
    try { await window.storage.set(entry.id, JSON.stringify(entry)); } catch {}
    if (supabase && user?.id) {
      try {
        await supabase.from("valuation_reports").insert({
          user_id: user.id,
          address: entry.address,
          zestimate: entry.zestimate,
          cma_mid: entry.cmaMid,
          score: entry.score,
          zpid: entry.zpid ? String(entry.zpid) : null,
          report: displayAnalysis,
        });
      } catch {}
    }
  }

  async function analyze() {
    if (!query.trim() || loading) return;
    setLoading(true); setBaseResult(null); setResult(null); setZillowRaw(null); setPropertyPhotos([]); setError(null); setStep(0);

    let zillow = null;
    try {
      const cached = await fetchCachedAnalysis(query);
      if (cached?.report) {
        const cleanReport = stripRehab(cached.report);
        const displayAnalysis = applyRehabToReport(cleanReport, rehabStyle);
        setBaseResult(cleanReport);
        setResult(displayAnalysis);
        setZillowRaw(cached.zillowRaw || null);
        hydratePhotos(cached.zillowRaw || null);
        saveSearchRecord(displayAnalysis, cached.zpid, cached.zillowRaw || null);
        return;
      }

      // ① Property data fetch
      setStep(0);
      await new Promise(r => setTimeout(r, 400));
      setStep(1);
      zillow = await fetchZillow(query);
      setZillowRaw(zillow);

      // ② OpenAI CMA
      setStep(2);
      await new Promise(r => setTimeout(r, 300));
      setStep(3);
      let analysis;
      try {
        analysis = await runOpenAI(query, zillow);
      } catch (analysisError) {
        analysis = buildBasicAnalysis(query, zillow, analysisError);
      }
      const baseAnalysis = stripRehab(analysis);
      const displayAnalysis = applyRehabToReport(baseAnalysis, rehabStyle);
      setStep(4);
      setBaseResult(baseAnalysis);
      setResult(displayAnalysis);
      hydratePhotos(zillow);
      saveCachedAnalysis({ address: query, zpid: zillow.zpid, report: baseAnalysis, zillowRaw: zillow });
      saveSearchRecord(displayAnalysis, zillow.zpid, zillow);

    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadFromHistory(item) {
    setQuery(item.address);
    if (item.report) {
      const cleanReport = stripRehab(item.report);
      setBaseResult(cleanReport);
      setResult(item.report);
      setRehabStyle(item.report.rehab?.styleKey || DEFAULT_REHAB_KEY);
      const raw = item.zillowRaw || null;
      setZillowRaw(raw);
      hydratePhotos(raw);
      if (!raw) {
        fetchCachedAnalysis(item.address).then((cached) => {
          if (cached?.zillowRaw) {
            setZillowRaw(cached.zillowRaw);
            hydratePhotos(cached.zillowRaw);
          }
        }).catch(() => null);
      }
    }
  }

  function updateRehabStyle(nextStyle) {
    setRehabStyle(nextStyle);
    const source = baseResult || stripRehab(result);
    if (source) setResult(applyRehabToReport(source, nextStyle));
  }

  const R = result;
  const P = R?.property;
  const Z = R?.zestimate;
  const M = R?.market;
  const A = R?.analysis;
  const V = R?.valuation;
  const H = R?.rehab;

  // Automated estimate vs CMA delta
  const zDelta = Z?.value && V?.mid ? Math.round(((V.mid - Z.value)/Z.value)*100*10)/10 : null;

  return (
    <div style={{ minHeight:"100vh", background:"#0c0e13", color:"#e8e0d0", fontFamily:"'Georgia',serif" }}>
      <style>{`
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes spin   { to{transform:rotate(360deg)} }
        input::placeholder { color:#2a2820; }
        @media (max-width: 720px) {
          .app-header { flex-direction: column; align-items: stretch !important; gap: 14px; }
          .app-header-actions { flex-wrap: wrap; }
          .search-row { flex-direction: column; }
          .search-row input, .search-row button { width: 100%; box-sizing: border-box; }
          .photo-grid { grid-template-columns: 1fr !important; }
          .hero-card-row, .property-title-row { flex-direction: column; align-items: flex-start !important; }
          .hero-card-row > div { text-align: left !important; }
          .valuation-amount { font-size: 32px !important; }
        }
      `}</style>

      {/* ── Header ── */}
      <div className="app-header" style={{ borderBottom:"1px solid #1a1c22", padding:"18px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:36, height:36, background:"linear-gradient(135deg,#c9a84c,#e8c97a)", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, boxShadow:"0 4px 16px rgba(201,168,76,.25)" }}>🏛</div>
          <div>
            <div style={{ fontSize:17, color:"#f0e8d8", letterSpacing:.3 }}>PropVal</div>
            <div style={{ fontSize:9, color:"#5a5850", letterSpacing:"2px", textTransform:"uppercase", fontFamily:"sans-serif" }}>AI Property Valuation SaaS</div>
          </div>
        </div>
        <div className="app-header-actions" style={{ display:"flex", gap:8, alignItems:"center" }}>
          {/* API key status */}
          <div style={{ display:"flex", alignItems:"center", gap:6, background:"#13161d", border:"1px solid #1e2028", borderRadius:8, padding:"5px 10px" }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:apiKey?"#64c878":"#e07060", boxShadow:`0 0 6px ${apiKey?"#64c878":"#e07060"}80` }}/>
            <span style={{ fontSize:10, color:apiKey?"#64c878":"#e07060", fontFamily:"sans-serif" }}>{apiKey?"Data Connected":"No API Key"}</span>
          </div>
          <button onClick={() => setShowHistory(true)} style={hdrBtn}>📁 History</button>
          <button onClick={() => setShowSettings(true)} style={hdrBtn}>⚙ Settings</button>
        </div>
      </div>

      <div style={{ maxWidth:740, margin:"0 auto", padding:"36px 20px 0" }}>

        {/* ── Hero text ── */}
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <h1 style={{ fontSize:26, fontWeight:"normal", margin:"0 0 8px", color:"#f0e8d8" }}>Enter any property address</h1>
          <p style={{ margin:0, fontSize:13, color:"#4a4840", fontFamily:"sans-serif" }}>
            Turn any address into a polished valuation lead report with live property data, AI analysis, and saved client history.
          </p>
        </div>

        {/* ── Search bar ── */}
        <div className="search-row" style={{ display:"flex", gap:10, marginBottom:16 }}>
          <input
            value={query}
            onChange={e=>setQuery(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&analyze()}
            placeholder="e.g. 4217 Oak Trail Dr, Austin, TX 78745"
            style={{ flex:1, background:"#13161d", border:"1px solid #222530", borderRadius:11, padding:"14px 18px", color:"#f0e8d8", fontSize:15, fontFamily:"'Georgia',serif", outline:"none", transition:"border-color .2s" }}
            onFocus={e=>e.target.style.borderColor="#c9a84c"}
            onBlur={e=>e.target.style.borderColor="#222530"}
          />
          <button onClick={analyze} disabled={loading||!query.trim()} style={{
            padding:"14px 24px", borderRadius:11, border:"none",
            cursor:loading||!query.trim()?"not-allowed":"pointer",
            background:loading||!query.trim()?"#1a1c22":"linear-gradient(135deg,#c9a84c,#e8c97a)",
            color:loading||!query.trim()?"#3a3830":"#0c0e13",
            fontFamily:"sans-serif", fontWeight:"bold", fontSize:13, letterSpacing:"1px", transition:"all .2s", whiteSpace:"nowrap",
          }}>
            {loading?"Analyzing…":"Analyze →"}
          </button>
        </div>

        {!apiKey && !loading && (
          <div style={{ background:"rgba(201,168,76,.06)", border:"1px solid rgba(201,168,76,.2)", borderRadius:10, padding:"10px 14px", marginBottom:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ fontSize:12, color:"#9a8060", fontFamily:"sans-serif" }}>⚡ Connect live property data to generate valuation reports</span>
            <button onClick={()=>setShowSettings(true)} style={{ background:"rgba(201,168,76,.15)", border:"1px solid rgba(201,168,76,.3)", borderRadius:7, padding:"5px 12px", cursor:"pointer", color:"#c9a84c", fontSize:11, fontFamily:"sans-serif" }}>Connect →</button>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div style={{ background:"#13161d", border:"1px solid #1e2028", borderRadius:12, padding:"20px 24px", marginBottom:20, animation:"fadeUp .3s ease" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
              <div style={{ width:18, height:18, border:"2px solid #c9a84c", borderTop:"2px solid transparent", borderRadius:"50%", animation:"spin 1s linear infinite", flexShrink:0 }}/>
              <div style={{ fontSize:13, color:"#9a9080", fontFamily:"sans-serif", animation:"pulse 2s infinite" }}>{STEPS[step]?.label}</div>
            </div>
            <div style={{ display:"flex", gap:4 }}>
              {STEPS.map((_,i) => <div key={i} style={{ flex:1, height:3, borderRadius:2, background:i<=step?"#c9a84c":"#1e2028", transition:"background .4s" }}/>)}
            </div>
          </div>
        )}

        {error && (
          <div style={{ background:"rgba(224,112,96,.07)", border:"1px solid rgba(224,112,96,.2)", borderRadius:10, padding:"12px 16px", marginBottom:20, fontSize:13, color:"#e07060", fontFamily:"sans-serif" }}>
            ⚠ {error}
          </div>
        )}

        {/* ── Results ── */}
        {R && (
          <div style={{ animation:"fadeUp .5s ease", paddingBottom:60 }}>

            {/* ①  Valuation Hero */}
            {Z?.value && (
              <div style={{ background:"linear-gradient(135deg,#13161d,#15130a)", border:"1px solid rgba(201,168,76,.3)", borderRadius:16, padding:"24px 26px", marginBottom:14 }}>
                <div className="hero-card-row" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                  <div>
                    <div style={{ fontSize:10, letterSpacing:"2px", textTransform:"uppercase", color:"#c9a84c", fontFamily:"sans-serif", marginBottom:4 }}>
                      AI Valuation Signal
                    </div>
                    <div className="valuation-amount" style={{ fontSize:40, color:"#e8c97a", lineHeight:1 }}>{fmtK(Z.value)}</div>
                    {Z.rentEstimate && (
                      <div style={{ fontSize:13, color:"#7a7060", fontFamily:"sans-serif", marginTop:5 }}>
                        Rental signal: <span style={{ color:"#c9a84c" }}>{fmtK(Z.rentEstimate)}/mo</span>
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    {/* Estimate vs CMA */}
                    {V?.mid && (
                      <div style={{ background:"#0d0f14", border:"1px solid #2a2820", borderRadius:10, padding:"10px 14px" }}>
                        <div style={{ fontSize:9, color:"#5a5850", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Our CMA</div>
                        <div style={{ fontSize:20, color:"#f0e8d8", fontFamily:"sans-serif" }}>{fmtK(V.mid)}</div>
                        <div style={{ fontSize:11, fontFamily:"sans-serif", color:zDelta===0?"#7a7060":zDelta>0?"#64c878":"#e07060", marginTop:3 }}>
                          {zDelta!=null ? `${zDelta>0?"+":""}${zDelta}% vs baseline` : ""}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <ValuationMeter value={Z.value} low={Z.low} high={Z.high} />
                {Z.note && <div style={{ fontSize:10, color:"#4a4840", fontFamily:"sans-serif", marginTop:10, fontStyle:"italic" }}>{Z.note}</div>}
                <div style={{ fontSize:9, color:"#2a2820", fontFamily:"sans-serif", marginTop:6 }}>Automated estimates are directional and should be reviewed by a licensed professional.</div>
              </div>
            )}

            <RehabSelector value={rehabStyle} onChange={updateRehabStyle} />
            <RehabSummary rehab={H} />
            <PhotoGallery photos={propertyPhotos} />

            {/* ②  Property Card */}
            <div style={{ background:"#13161d", border:"1px solid #222530", borderRadius:14, padding:"22px 24px", marginBottom:14 }}>
              <div className="property-title-row" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:17, color:"#f0e8d8", marginBottom:4 }}>{P?.address}</div>
                  <div style={{ fontSize:12, color:"#4a4840", fontFamily:"sans-serif" }}>
                    {P?.neighborhood && `${P.neighborhood} · `}{P?.city}, {P?.state} {P?.zip}
                  </div>
                </div>
                <Badge tone="gold">{P?.type || "Residential"}</Badge>
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))", background:"#0d0f14", borderRadius:10, overflow:"hidden", border:"1px solid #1a1c22", marginBottom:12 }}>
                {[
                  { l:"Beds",      v: P?.beds      ?? "—" },
                  { l:"Baths",     v: P?.baths     ?? "—" },
                  { l:"Sq Ft",     v: P?.sqft      ? Number(P.sqft).toLocaleString() : "—" },
                  { l:"Year Built",v: P?.yearBuilt  ?? "—" },
                ].map(({l,v},i) => (
                  <div key={i} style={{ padding:"14px 0", borderRight:i<3?"1px solid #1a1c22":"none", textAlign:"center" }}>
                    <div style={{ fontSize:20, color:"#f0e8d8", marginBottom:3 }}>{v}</div>
                    <div style={{ fontSize:9, color:"#4a4840", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1 }}>{l}</div>
                  </div>
                ))}
              </div>

              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {P?.lotSqft>0  && <Badge>🏡 Lot {Number(P.lotSqft).toLocaleString()} sqft</Badge>}
                {P?.stories>0  && <Badge>🏢 {P.stories}-story</Badge>}
                {P?.garage     && <Badge>🚗 Garage</Badge>}
                {P?.pool       && <Badge>🏊 Pool</Badge>}
                {zillowRaw?.zpid && <Badge tone="blue">ref: {zillowRaw.zpid}</Badge>}
              </div>

              {P?.description && <div style={{ marginTop:12, fontSize:12, color:"#6a6258", fontFamily:"sans-serif", lineHeight:1.6, fontStyle:"italic", borderTop:"1px solid #1a1c22", paddingTop:12 }}>{P.description}</div>}
            </div>

            {/* ③  Price & Tax History */}
            {(R.priceHistory?.length > 0 || P?.lastSalePrice) && (
              <div style={{ background:"#13161d", border:"1px solid #222530", borderRadius:14, padding:"22px 24px", marginBottom:14 }}>
                <SectionLabel>Price & Tax History</SectionLabel>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10, marginBottom:R.priceHistory?.length?18:0 }}>
                  {[
                    { l:"Last Sale",    v:fmtK(P?.lastSalePrice), s:P?.lastSaleDate },
                    { l:"Tax Assessed", v:fmtK(P?.taxAssessedValue), s:"Current assessed" },
                    { l:"List Price",   v:P?.listPrice ? fmtK(P.listPrice) : "Off Market", s:P?.daysOnMarket?`${P.daysOnMarket} days on market`:null },
                  ].map(({l,v,s}) => (
                    <div key={l} style={{ background:"#0d0f14", borderRadius:10, padding:"13px 14px", border:"1px solid #1a1c22" }}>
                      <div style={{ fontSize:9, color:"#4a4840", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>{l}</div>
                      <div style={{ fontSize:18, color:"#f0e8d8" }}>{v}</div>
                      {s && <div style={{ fontSize:10, color:"#4a4840", fontFamily:"sans-serif", marginTop:3 }}>{s}</div>}
                    </div>
                  ))}
                </div>
                {R.priceHistory?.length > 0 && <PriceTimeline history={R.priceHistory} />}
              </div>
            )}

            {/* ④  Market Context */}
            <div style={{ background:"#13161d", border:"1px solid #222530", borderRadius:14, padding:"22px 24px", marginBottom:14 }}>
              <SectionLabel>Local Market Context</SectionLabel>
              <Row label="Median Sale Price" value={fmtK(M?.medianSalePrice)} />
              <Row label="Median $/sqft" value={M?.medianPricePerSqft ? `$${M.medianPricePerSqft}` : "—"} />
              <Row label="Avg Days on Market" value={M?.avgDaysOnMarket ? `${M.avgDaysOnMarket} days` : "—"} />
              <Row label="List-to-Sale Ratio" value={M?.listToSaleRatio ? `${(M.listToSaleRatio*100).toFixed(1)}%` : "—"} sub="Above 100% = selling over asking" />
              <Row label="Inventory Level" value={M?.inventory||"—"} sub={M?.inventoryNote} />
              <Row label="Price Trend" value="" last right={
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <Badge tone={M?.trend==="appreciating"?"green":M?.trend==="declining"?"red":"gold"}>
                    {M?.trend==="appreciating"?"↑":M?.trend==="declining"?"↓":"→"} {M?.trend}
                  </Badge>
                  {M?.trendPct!=null && <span style={{ fontSize:13, color:M.trendPct>0?"#64c878":"#e07060", fontFamily:"sans-serif" }}>{M.trendPct>0?"+":""}{M.trendPct}% YoY</span>}
                </div>
              }/>
              {M?.trendNote && <div style={{ fontSize:11, color:"#4a4840", fontFamily:"sans-serif", marginTop:8, fontStyle:"italic" }}>{M.trendNote}</div>}
            </div>

            {/* ⑤  Comps */}
            {R.comps?.length > 0 && (
              <div style={{ background:"#13161d", border:"1px solid #222530", borderRadius:14, padding:"22px 24px", marginBottom:14 }}>
                <SectionLabel>Comparable Sales ({R.comps.length})</SectionLabel>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {R.comps.map((c,i) => (
                    <div key={i} style={{ background:"#0d0f14", borderRadius:10, padding:"13px 15px", border:"1px solid #1a1c22" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:7 }}>
                        <div>
                          <div style={{ fontSize:13, color:"#d0c8b8", fontFamily:"sans-serif", marginBottom:2 }}>{c.address}</div>
                          <div style={{ fontSize:10, color:"#4a4840", fontFamily:"sans-serif" }}>{c.soldDate} · {c.distance}</div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:16, color:"#e8c97a", fontFamily:"sans-serif" }}>{fmt(c.salePrice)}</div>
                          <div style={{ fontSize:10, color:"#4a4840", fontFamily:"sans-serif" }}>{c.pricePerSqft?`$${c.pricePerSqft}/sqft`:""}</div>
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                        <Badge sm>{c.beds}bd · {c.baths}ba</Badge>
                        {c.sqft && <Badge sm>{Number(c.sqft).toLocaleString()} sqft</Badge>}
                        <Badge sm tone={c.similarity==="high"?"green":c.similarity==="medium"?"gold":"neutral"}>{c.similarity} match</Badge>
                        {c.adjustments && <span style={{ fontSize:10, color:"#4a4840", fontFamily:"sans-serif", alignSelf:"center", fontStyle:"italic" }}>{c.adjustments}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ⑥  Valuation Range */}
            <div style={{ background:"linear-gradient(135deg,#13161d,#16140e)", border:"1px solid rgba(201,168,76,.25)", borderRadius:14, padding:"24px 26px", marginBottom:14 }}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:20, alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:10, letterSpacing:"2px", textTransform:"uppercase", color:"#c9a84c", fontFamily:"sans-serif", marginBottom:6 }}>CMA Estimated Value</div>
                  <div style={{ fontSize:38, color:"#e8c97a", lineHeight:1.1, marginBottom:4 }}>{fmtK(V?.mid)}</div>
                  <div style={{ fontSize:13, color:"#6a6258", fontFamily:"sans-serif", marginBottom:14 }}>{fmtK(V?.low)} – {fmtK(V?.high)}</div>
                  <div style={{ position:"relative", height:6, background:"#1a1c22", borderRadius:4, width:"80%", marginBottom:10 }}>
                    <div style={{ position:"absolute", inset:0, background:"linear-gradient(90deg,#2a2820,rgba(201,168,76,.4),#2a2820)", borderRadius:4 }}/>
                    <div style={{ position:"absolute", top:-3, left:"50%", transform:"translateX(-50%)", width:12, height:12, borderRadius:"50%", background:"#c9a84c", boxShadow:"0 0 10px rgba(201,168,76,.7)" }}/>
                  </div>
                  {V?.pricePerSqftRange && <div style={{ fontSize:11, color:"#6a6258", fontFamily:"sans-serif" }}>$/sqft range: <span style={{ color:"#c9a84c" }}>{V.pricePerSqftRange}</span></div>}
                  {V?.method && <div style={{ fontSize:10, color:"#2a2820", fontFamily:"sans-serif", marginTop:8, fontStyle:"italic" }}>{V.method}</div>}
                </div>
                {A?.investmentScore != null && <ScoreArc score={A.investmentScore} />}
              </div>
            </div>

            {/* ⑦  Analysis */}
            <div style={{ background:"#13161d", border:"1px solid #222530", borderRadius:14, padding:"22px 24px", marginBottom:14 }}>
              <SectionLabel>Analysis Breakdown</SectionLabel>

              {A?.vsZestimate  != null && <Row label="CMA vs Baseline"  value="" right={<DeltaBadge v={A.vsZestimate}  suffix="vs baseline" />} />}
              {A?.vsListPrice  != null && <Row label="CMA vs List Price" value="" right={<DeltaBadge v={A.vsListPrice}  suffix="vs asking"   />} />}
              {A?.vsLastSale   != null && <Row label="vs Last Sale"       value="" right={<DeltaBadge v={A.vsLastSale}   suffix="since last sale" />} />}
              {A?.vsMedian     != null && <Row label="vs Area Median"     value="" last right={<DeltaBadge v={A.vsMedian} suffix="vs median" invert />} />}

              {/* Strengths */}
              {A?.strengths?.length > 0 && (
                <div style={{ marginTop:16, marginBottom:12 }}>
                  <div style={{ fontSize:9, color:"#4a4840", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Strengths</div>
                  {A.strengths.map((s,i) => <BulletLine key={i} text={s} color="#64c878" icon="✓" />)}
                </div>
              )}

              {/* Risks */}
              {A?.risks?.length > 0 && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:9, color:"#4a4840", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Risks / Watch Points</div>
                  {A.risks.map((r,i) => <BulletLine key={i} text={r} color="#e07060" icon="⚠" />)}
                </div>
              )}

              {/* Highlights */}
              {A?.highlights?.length > 0 && (
                <div style={{ background:"#0d0f14", borderRadius:10, padding:"13px 15px", border:"1px solid #1a1c22" }}>
                  <div style={{ fontSize:9, color:"#4a4840", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Key Findings</div>
                  {A.highlights.map((h,i) => <BulletLine key={i} text={h} color="#c9a84c" icon="◆" small />)}
                </div>
              )}
            </div>

            {/* ⑧  Analyst Note */}
            {A?.analystNote && (
              <div style={{ background:"rgba(201,168,76,.04)", border:"1px solid rgba(201,168,76,.15)", borderRadius:14, padding:"20px 24px", marginBottom:14 }}>
                <div style={{ fontSize:9, color:"#c9a84c", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:"2px", marginBottom:10 }}>Analyst Summary</div>
                <div style={{ fontSize:14, color:"#b0a898", lineHeight:1.85 }}>{A.analystNote}</div>
              </div>
            )}

            {/* ⑨  Verdict */}
            {A?.verdict && (
              <div style={{ background:"#13161d", border:"1px solid #222530", borderRadius:14, padding:"18px 22px", display:"flex", alignItems:"center", gap:14 }}>
                <div style={{ width:46, height:46, borderRadius:"50%", background:"rgba(201,168,76,.08)", border:"1px solid rgba(201,168,76,.2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
                  {A.investmentScore>=70?"🟢":A.investmentScore>=45?"🟡":"🔴"}
                </div>
                <div>
                  <div style={{ fontSize:9, color:"#4a4840", fontFamily:"sans-serif", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Verdict</div>
                  <div style={{ fontSize:15, color:"#f0e8d8" }}>{A.verdict}</div>
                </div>
              </div>
            )}

          </div>
        )}

        {/* Empty state */}
        {!R && !loading && (
          <div style={{ textAlign:"center", padding:"60px 0", color:"#2a2820" }}>
            <div style={{ fontSize:48, marginBottom:10 }}>🏠</div>
            <div style={{ fontFamily:"sans-serif", fontSize:13 }}>Enter a property address above to begin</div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showSettings && <SettingsModal onClose={()=>setShowSettings(false)} user={user} theme={theme} setTheme={setTheme} onSignOut={onSignOut} />}
      {showHistory  && <HistoryPanel  onClose={()=>setShowHistory(false)}  onLoad={loadFromHistory} user={user} />}
    </div>
  );
}

// ── Micro-components ──────────────────────────────────────────────────────────
const hdrBtn = { background:"#13161d", border:"1px solid #1e2028", borderRadius:8, padding:"6px 12px", cursor:"pointer", color:"#9a9080", fontSize:11, fontFamily:"sans-serif" };
const SectionLabel = ({children}) => <div style={{ fontSize:10, letterSpacing:"2px", textTransform:"uppercase", color:"#7a7060", fontFamily:"sans-serif", marginBottom:12, paddingBottom:8, borderBottom:"1px solid #1e2028" }}>{children}</div>;
const BulletLine = ({text,color,icon,small}) => (
  <div style={{ display:"flex", gap:8, alignItems:"flex-start", marginBottom:6 }}>
    <span style={{ color, marginTop:1, fontSize:small?9:11, flexShrink:0 }}>{icon}</span>
    <span style={{ fontSize:small?11:12, color:"#a09888", fontFamily:"sans-serif", lineHeight:1.5 }}>{text}</span>
  </div>
);
const DeltaBadge = ({v,suffix,invert}) => {
  const positive = invert ? v < 0 : v > 0;
  const tone = v===0?"neutral":positive?"green":"red";
  return <Badge tone={tone}>{v>0?"+":""}{v}% {suffix}</Badge>;
};
