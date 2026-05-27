import React, { useState, useEffect } from "react";
import { supabase } from "./supabaseClient.js";

const HP = "propval:h:";

async function fetchAllReports(user) {
  let cloud = [];
  if (supabase && user?.id) {
    const { data } = await supabase
      .from("valuation_reports")
      .select("id, address, zestimate, cma_mid, score, zpid, report, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) {
      cloud = data.map((row) => ({
        id: row.id,
        savedAt: new Date(row.created_at).getTime(),
        address: row.address,
        report: row.report,
      }));
    }
  }
  let local = [];
  try {
    const r = await window.storage.list(HP);
    if (r?.keys?.length) {
      const all = await Promise.all(
        r.keys.map(async (k) => {
          try {
            const v = await window.storage.get(k);
            return v ? JSON.parse(v.value) : null;
          } catch {
            return null;
          }
        })
      );
      local = all.filter(Boolean);
    }
  } catch {}
  
  const combined = [...cloud, ...local.filter(l => !cloud.some(c => c.id === l.id))];
  return combined.sort((a, b) => b.savedAt - a.savedAt);
}

function toolTheme(theme) {
  const light = theme === "light";
  return {
    panel: light ? "#ffffff" : "#13161d",
    border: light ? "#ded6c8" : "#222530",
    text: light ? "#201b14" : "#f0e8d8",
    muted: light ? "#6d6254" : "#8a8174",
    bg: light ? "#fbf8f2" : "#0d0f14",
    accent: "#c9a84c",
  };
}

export function LeadsPage({ user, theme, onLoadReport }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const t = toolTheme(theme);

  useEffect(() => {
    fetchAllReports(user).then((res) => {
      setReports(res.filter((r) => r.report?.meta?.lead?.name || r.report?.meta?.lead?.email));
      setLoading(false);
    });
  }, [user]);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8, color: t.text }}>Leads Pipeline</h1>
      <p style={{ color: t.muted, marginBottom: 24 }}>All captured leads across your saved property reports.</p>
      
      {loading ? (
        <div style={{ color: t.muted }}>Loading leads...</div>
      ) : reports.length === 0 ? (
        <div style={{ background: t.panel, padding: 40, borderRadius: 16, textAlign: "center", border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>📭</div>
          <div style={{ color: t.text, fontWeight: 600 }}>No leads yet</div>
          <div style={{ color: t.muted, fontSize: 13, marginTop: 4 }}>Save a report with lead info to see it here.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {reports.map((r, i) => {
            const lead = r.report.meta.lead;
            const status = r.report.meta.pipelineStatus;
            return (
              <div key={i} onClick={() => onLoadReport(r)} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", transition: "transform 0.2s", ":hover": { transform: "translateY(-2px)" } }}>
                <div>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 18, fontWeight: 600, color: t.text }}>{lead.name || "Unnamed"}</div>
                    <span style={{ fontSize: 11, padding: "3px 8px", background: "rgba(201,168,76,.15)", color: t.accent, borderRadius: 12 }}>{status || "New Lead"}</span>
                  </div>
                  <div style={{ color: t.muted, fontSize: 13, display: "flex", gap: 16 }}>
                    <span>{lead.email || "No email"}</span>
                    <span>{lead.phone || "No phone"}</span>
                    <span>Timeline: {lead.timeline}</span>
                  </div>
                  <div style={{ fontSize: 12, color: t.accent, marginTop: 8 }}>🏠 {r.address}</div>
                </div>
                <button style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, padding: "8px 16px", borderRadius: 8, cursor: "pointer" }}>Open Report →</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DealsPage({ user, theme, onLoadReport }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const t = toolTheme(theme);

  useEffect(() => {
    fetchAllReports(user).then((res) => {
      setReports(res.filter((r) => r.report?.meta?.dealMetrics && r.report?.meta?.deal?.purchasePrice));
      setLoading(false);
    });
  }, [user]);

  const fmt = (n) => n != null ? "$" + Number(n).toLocaleString() : "—";

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8, color: t.text }}>Deals Dashboard</h1>
      <p style={{ color: t.muted, marginBottom: 24 }}>Financial analysis for properties you are actively underwriting.</p>
      
      {loading ? (
        <div style={{ color: t.muted }}>Loading deals...</div>
      ) : reports.length === 0 ? (
        <div style={{ background: t.panel, padding: 40, borderRadius: 16, textAlign: "center", border: `1px solid ${t.border}` }}>
          <div style={{ fontSize: 24, marginBottom: 10 }}>💼</div>
          <div style={{ color: t.text, fontWeight: 600 }}>No deals underwritten</div>
          <div style={{ color: t.muted, fontSize: 13, marginTop: 4 }}>Add purchase price in the Deal tab of a report to see it here.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {reports.map((r, i) => {
            const m = r.report.meta.dealMetrics;
            return (
              <div key={i} onClick={() => onLoadReport(r)} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, cursor: "pointer" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.address}</div>
                <div style={{ color: t.muted, fontSize: 12, marginBottom: 16 }}>{new Date(r.savedAt).toLocaleDateString()}</div>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: t.bg, padding: 10, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: t.muted, textTransform: "uppercase" }}>Purchase</div>
                    <div style={{ fontSize: 16, color: t.text }}>{fmt(m.purchasePrice)}</div>
                  </div>
                  <div style={{ background: t.bg, padding: 10, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: t.muted, textTransform: "uppercase" }}>Projected Profit</div>
                    <div style={{ fontSize: 16, color: m.profit > 0 ? "#64c878" : "#e07060" }}>{fmt(m.profit)}</div>
                  </div>
                  <div style={{ background: t.bg, padding: 10, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: t.muted, textTransform: "uppercase" }}>Total Cost</div>
                    <div style={{ fontSize: 16, color: t.text }}>{fmt(m.totalCost)}</div>
                  </div>
                  <div style={{ background: t.bg, padding: 10, borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: t.muted, textTransform: "uppercase" }}>ROI</div>
                    <div style={{ fontSize: 16, color: t.accent }}>{m.roi != null ? m.roi + "%" : "—"}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ConfidencePage({ user, theme, onLoadReport }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const t = toolTheme(theme);

  useEffect(() => {
    fetchAllReports(user).then((res) => {
      setReports(res.filter((r) => r.report?.meta?.compConfidence));
      setLoading(false);
    });
  }, [user]);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8, color: t.text }}>Data Confidence</h1>
      <p style={{ color: t.muted, marginBottom: 24 }}>Review the AI's confidence scores across all your valuations.</p>
      
      {loading ? (
        <div style={{ color: t.muted }}>Loading data...</div>
      ) : reports.length === 0 ? (
        <div style={{ background: t.panel, padding: 40, borderRadius: 16, textAlign: "center", border: `1px solid ${t.border}` }}>
          <div style={{ color: t.text, fontWeight: 600 }}>No reports</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {reports.map((r, i) => {
            const conf = r.report.meta.compConfidence;
            const scoreColor = conf.score >= 75 ? "#64c878" : conf.score >= 50 ? "#c9a84c" : "#e07060";
            return (
              <div key={i} onClick={() => onLoadReport(r)} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: 16, display: "flex", gap: 20, alignItems: "center", cursor: "pointer" }}>
                <div style={{ width: 60, height: 60, borderRadius: "50%", border: `3px solid ${scoreColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: "bold", color: scoreColor, flexShrink: 0 }}>
                  {conf.score}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: t.text, marginBottom: 4 }}>{r.address}</div>
                  <div style={{ fontSize: 12, color: t.muted, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {conf.reasons.map((reason, j) => (
                      <span key={j} style={{ background: t.bg, padding: "2px 8px", borderRadius: 4 }}>{reason}</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ActionsPage({ user, theme, onLoadReport }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const t = toolTheme(theme);

  useEffect(() => {
    fetchAllReports(user).then((res) => {
      setReports(res);
      setLoading(false);
    });
  }, [user]);

  async function copyShareLink(e, reportId) {
    e.stopPropagation();
    const url = new URL(window.location.href);
    url.searchParams.set("report", reportId);
    url.searchParams.delete("address");
    await navigator.clipboard?.writeText(url.toString());
    alert("Share link copied to clipboard!");
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8, color: t.text }}>Recent Actions & Reports</h1>
      <p style={{ color: t.muted, marginBottom: 24 }}>Quickly export, share, or rerun your saved reports.</p>
      
      {loading ? (
        <div style={{ color: t.muted }}>Loading actions...</div>
      ) : reports.length === 0 ? (
        <div style={{ background: t.panel, padding: 40, borderRadius: 16, textAlign: "center", border: `1px solid ${t.border}` }}>
          <div style={{ color: t.text, fontWeight: 600 }}>No reports saved</div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {reports.map((r, i) => {
            return (
              <div key={i} onClick={() => onLoadReport(r)} style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: t.text, marginBottom: 4 }}>{r.address}</div>
                  <div style={{ fontSize: 12, color: t.muted }}>Saved on {new Date(r.savedAt).toLocaleDateString()}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {String(r.id).startsWith(HP) ? null : (
                    <button onClick={(e) => copyShareLink(e, r.id)} style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Copy Link</button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); window.print(); }} style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text, padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Export PDF</button>
                  <button onClick={() => onLoadReport(r)} style={{ background: "linear-gradient(135deg,#c9a84c,#e8c97a)", border: "none", color: "#0c0e13", fontWeight: "bold", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Open</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
