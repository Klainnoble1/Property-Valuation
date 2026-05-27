import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabaseClient.js";

const HP = "propval:h:";

const PIPELINE_STATUSES = ["New Lead", "Contacted", "Offer Made", "Under Contract", "Closed"];

const COLUMN_META = {
  "New Lead":        { emoji: "🆕", color: "#6b7280" },
  "Contacted":       { emoji: "📞", color: "#3b82f6" },
  "Offer Made":      { emoji: "📝", color: "#f59e0b" },
  "Under Contract":  { emoji: "🔒", color: "#8b5cf6" },
  "Closed":          { emoji: "✅", color: "#10b981" },
};

// ── Data Fetching ─────────────────────────────────────────────────────────────

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
        isCloud: true,
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
          } catch { return null; }
        })
      );
      local = all.filter(Boolean).map(l => ({ ...l, isCloud: false }));
    }
  } catch {}
  const combined = [...cloud, ...local.filter(l => !cloud.some(c => c.id === l.id))];
  return combined.sort((a, b) => b.savedAt - a.savedAt);
}

async function persistStatusChange(report, newStatus, user) {
  // Update cloud
  if (supabase && user?.id && report.isCloud) {
    const updatedReport = {
      ...report.report,
      meta: { ...(report.report?.meta || {}), pipelineStatus: newStatus },
    };
    await supabase
      .from("valuation_reports")
      .update({ report: updatedReport })
      .eq("id", report.id)
      .eq("user_id", user.id);
  }
  // Update local storage for local reports
  try {
    const key = String(report.id).startsWith(HP) ? report.id : null;
    if (key) {
      const raw = await window.storage.get(key);
      if (raw?.value) {
        const parsed = JSON.parse(raw.value);
        parsed.report = {
          ...parsed.report,
          meta: { ...(parsed.report?.meta || {}), pipelineStatus: newStatus },
        };
        await window.storage.set(key, JSON.stringify(parsed));
      }
    }
  } catch {}
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function t(theme) {
  const light = theme === "light";
  return {
    page:   light ? "#f0ebe1" : "#0b0d11",
    panel:  light ? "#ffffff" : "#13161d",
    col:    light ? "#f7f3ec" : "#0f1118",
    border: light ? "#e0d9ce" : "#1e2230",
    text:   light ? "#201b14" : "#f0e8d8",
    muted:  light ? "#6d6254" : "#7a7468",
    sub:    light ? "#9e9082" : "#5a544e",
    bg:     light ? "#fbf8f2" : "#0d0f14",
    accent: "#c9a84c",
    dragOver: light ? "rgba(201,168,76,.12)" : "rgba(201,168,76,.08)",
  };
}

// ── Shared Kanban Column ───────────────────────────────────────────────────────

function KanbanColumn({ status, children, count, onDrop, onDragOver, onDragLeave, isDragOver, theme }) {
  const tk = t(theme);
  const meta = COLUMN_META[status];
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      style={{
        minWidth: 260,
        flex: "0 0 260px",
        background: isDragOver ? tk.dragOver : tk.col,
        border: `1.5px solid ${isDragOver ? tk.accent : tk.border}`,
        borderRadius: 14,
        padding: "14px 12px",
        transition: "border-color 0.18s, background 0.18s",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Column header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 16 }}>{meta.emoji}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: tk.text, flex: 1, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{status}</span>
        <span style={{
          fontSize: 11, fontWeight: 700,
          background: `${meta.color}22`,
          color: meta.color,
          border: `1px solid ${meta.color}44`,
          padding: "2px 8px", borderRadius: 20,
        }}>{count}</span>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 60 }}>
        {children}
      </div>
    </div>
  );
}

// ── Leads Kanban Card ─────────────────────────────────────────────────────────

function LeadCard({ report, onLoadReport, theme, onDragStart }) {
  const tk = t(theme);
  const lead = report.report?.meta?.lead || {};
  const score = report.report?.analysis?.investmentScore;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? tk.panel : `${tk.panel}cc`,
        border: `1px solid ${hovered ? tk.accent + "88" : tk.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "grab",
        transition: "all 0.18s",
        transform: hovered ? "translateY(-2px)" : "none",
        boxShadow: hovered ? `0 8px 24px rgba(0,0,0,0.18)` : "none",
      }}
    >
      {/* Name row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: tk.text, fontFamily: "'Plus Jakarta Sans', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>
          {lead.name || "Unnamed Lead"}
        </div>
        {score != null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: score >= 70 ? "#10b981" : score >= 45 ? tk.accent : "#ef4444", background: score >= 70 ? "#10b98122" : score >= 45 ? "#c9a84c22" : "#ef444422", padding: "2px 7px", borderRadius: 10, border: `1px solid ${score >= 70 ? "#10b98144" : score >= 45 ? "#c9a84c44" : "#ef444444"}` }}>
            {score}/100
          </span>
        )}
      </div>

      {/* Address */}
      <div style={{ fontSize: 11, color: tk.accent, marginBottom: 8, display: "flex", alignItems: "center", gap: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span>🏠</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{report.address}</span>
      </div>

      {/* Contact info */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
        {lead.email && <div style={{ fontSize: 11, color: tk.muted, display: "flex", gap: 5 }}><span>✉</span>{lead.email}</div>}
        {lead.phone && <div style={{ fontSize: 11, color: tk.muted, display: "flex", gap: 5 }}><span>📱</span>{lead.phone}</div>}
        {lead.timeline && <div style={{ fontSize: 11, color: tk.muted, display: "flex", gap: 5 }}><span>⏱</span>{lead.timeline}</div>}
      </div>

      <button
        onClick={() => onLoadReport(report)}
        style={{
          width: "100%", padding: "6px", background: "linear-gradient(135deg,#c9a84c,#e8c97a)",
          border: "none", borderRadius: 7, color: "#0c0e13",
          fontWeight: 700, fontSize: 11, cursor: "pointer",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}
      >
        Open Report →
      </button>
    </div>
  );
}

// ── Deal Kanban Card ──────────────────────────────────────────────────────────

function DealCard({ report, onLoadReport, theme, onDragStart }) {
  const tk = t(theme);
  const m = report.report?.meta?.dealMetrics || {};
  const deal = report.report?.meta?.deal || {};
  const [hovered, setHovered] = useState(false);

  const fmt = (n) => n != null && n !== "" ? "$" + Number(n).toLocaleString() : "—";
  const profitPos = m.profit > 0;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? tk.panel : `${tk.panel}cc`,
        border: `1px solid ${hovered ? tk.accent + "88" : tk.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "grab",
        transition: "all 0.18s",
        transform: hovered ? "translateY(-2px)" : "none",
        boxShadow: hovered ? `0 8px 24px rgba(0,0,0,0.18)` : "none",
      }}
    >
      {/* Address */}
      <div style={{ fontSize: 13, fontWeight: 700, color: tk.text, marginBottom: 4, fontFamily: "'Plus Jakarta Sans', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {report.address}
      </div>
      <div style={{ fontSize: 10, color: tk.muted, marginBottom: 10 }}>
        {new Date(report.savedAt).toLocaleDateString()}
      </div>

      {/* Financial metrics grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        <div style={{ background: tk.bg, borderRadius: 7, padding: "7px 8px" }}>
          <div style={{ fontSize: 9, color: tk.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Purchase</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: tk.text }}>{fmt(deal.purchasePrice)}</div>
        </div>
        <div style={{ background: tk.bg, borderRadius: 7, padding: "7px 8px" }}>
          <div style={{ fontSize: 9, color: tk.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Profit</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: m.profit != null ? (profitPos ? "#10b981" : "#ef4444") : tk.muted }}>{fmt(m.profit)}</div>
        </div>
        <div style={{ background: tk.bg, borderRadius: 7, padding: "7px 8px" }}>
          <div style={{ fontSize: 9, color: tk.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Total Cost</div>
          <div style={{ fontSize: 13, color: tk.text }}>{fmt(m.totalCost)}</div>
        </div>
        <div style={{ background: tk.bg, borderRadius: 7, padding: "7px 8px" }}>
          <div style={{ fontSize: 9, color: tk.sub, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>ROI</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: tk.accent }}>{m.roi != null ? m.roi + "%" : "—"}</div>
        </div>
      </div>

      <button
        onClick={() => onLoadReport(report)}
        style={{
          width: "100%", padding: "6px", background: "linear-gradient(135deg,#c9a84c,#e8c97a)",
          border: "none", borderRadius: 7, color: "#0c0e13",
          fontWeight: 700, fontSize: 11, cursor: "pointer",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}
      >
        Open Deal →
      </button>
    </div>
  );
}

// ── Shared Kanban Board Logic ─────────────────────────────────────────────────

function KanbanBoard({ reports, setReports, user, theme, onLoadReport, CardComponent, filterFn, emptyIcon, emptyText, emptySubtext }) {
  const tk = t(theme);
  const dragItem = useRef(null);
  const [dragOver, setDragOver] = useState(null); // which column is active

  const filtered = reports.filter(filterFn);

  const byStatus = PIPELINE_STATUSES.reduce((acc, s) => {
    acc[s] = filtered.filter(r => (r.report?.meta?.pipelineStatus || "New Lead") === s);
    return acc;
  }, {});

  function handleDragStart(reportId) {
    dragItem.current = reportId;
  }

  function handleDragOver(e, status) {
    e.preventDefault();
    setDragOver(status);
  }

  function handleDragLeave() {
    setDragOver(null);
  }

  async function handleDrop(e, newStatus) {
    e.preventDefault();
    setDragOver(null);
    const id = dragItem.current;
    if (!id) return;

    const report = reports.find(r => r.id === id);
    if (!report || (report.report?.meta?.pipelineStatus || "New Lead") === newStatus) return;

    // Optimistically update state
    setReports(prev => prev.map(r => {
      if (r.id !== id) return r;
      return {
        ...r,
        report: {
          ...r.report,
          meta: { ...(r.report?.meta || {}), pipelineStatus: newStatus },
        },
      };
    }));

    // Persist to Supabase / localStorage
    await persistStatusChange(report, newStatus, user);
    dragItem.current = null;
  }

  if (filtered.length === 0) {
    return (
      <div style={{ background: tk.panel, padding: 48, borderRadius: 16, textAlign: "center", border: `1px solid ${tk.border}` }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>{emptyIcon}</div>
        <div style={{ color: tk.text, fontWeight: 700, fontSize: 18, fontFamily: "'Plus Jakarta Sans', sans-serif", marginBottom: 6 }}>{emptyText}</div>
        <div style={{ color: tk.muted, fontSize: 13 }}>{emptySubtext}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 16 }}>
      {PIPELINE_STATUSES.map(status => (
        <KanbanColumn
          key={status}
          status={status}
          count={byStatus[status].length}
          isDragOver={dragOver === status}
          onDragOver={(e) => handleDragOver(e, status)}
          onDrop={(e) => handleDrop(e, status)}
          onDragLeave={handleDragLeave}
          theme={theme}
        >
          {byStatus[status].map(r => (
            <CardComponent
              key={r.id}
              report={r}
              theme={theme}
              onLoadReport={onLoadReport}
              onDragStart={() => handleDragStart(r.id)}
            />
          ))}
        </KanbanColumn>
      ))}
    </div>
  );
}

// ── Page Header ───────────────────────────────────────────────────────────────

function PageHeader({ title, subtitle, totalCount, theme }) {
  const tk = t(theme);
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: 0, color: tk.text, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{title}</h1>
        {totalCount > 0 && (
          <span style={{ fontSize: 13, color: tk.accent, fontWeight: 600, background: "rgba(201,168,76,.1)", border: "1px solid rgba(201,168,76,.25)", padding: "2px 10px", borderRadius: 20 }}>
            {totalCount} total
          </span>
        )}
      </div>
      <p style={{ color: tk.muted, margin: 0, fontSize: 14, fontFamily: "'Inter', sans-serif" }}>{subtitle}</p>
    </div>
  );
}

// ── Leads Page ────────────────────────────────────────────────────────────────

export function LeadsPage({ user, theme, onLoadReport }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const tk = t(theme);

  useEffect(() => {
    fetchAllReports(user).then((res) => {
      setReports(res);
      setLoading(false);
    });
  }, [user]);

  const leadReports = reports.filter(r => r.report?.meta?.lead?.name || r.report?.meta?.lead?.email);

  return (
    <div style={{ padding: "36px 24px", minHeight: "100%", background: tk.page }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <PageHeader
          title="Leads Pipeline"
          subtitle="Drag leads between stages to update their status. Changes are saved instantly."
          totalCount={leadReports.length}
          theme={theme}
        />
        {loading ? (
          <div style={{ color: tk.muted, fontFamily: "'Inter', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Loading leads...
          </div>
        ) : (
          <KanbanBoard
            reports={reports}
            setReports={setReports}
            user={user}
            theme={theme}
            onLoadReport={onLoadReport}
            CardComponent={LeadCard}
            filterFn={r => r.report?.meta?.lead?.name || r.report?.meta?.lead?.email}
            emptyIcon="📭"
            emptyText="No leads yet"
            emptySubtext="Save a report with lead info to see it appear here."
          />
        )}
      </div>
    </div>
  );
}

// ── Deals Page ────────────────────────────────────────────────────────────────

export function DealsPage({ user, theme, onLoadReport }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const tk = t(theme);

  useEffect(() => {
    fetchAllReports(user).then((res) => {
      setReports(res);
      setLoading(false);
    });
  }, [user]);

  const dealReports = reports.filter(r => r.report?.meta?.deal?.purchasePrice);

  // Summary stats
  const totalPurchase = dealReports.reduce((s, r) => s + (Number(r.report?.meta?.deal?.purchasePrice) || 0), 0);
  const totalProfit   = dealReports.reduce((s, r) => s + (Number(r.report?.meta?.dealMetrics?.profit)  || 0), 0);
  const fmt = (n) => n > 0 ? "$" + Math.round(n).toLocaleString() : "—";

  return (
    <div style={{ padding: "36px 24px", minHeight: "100%", background: tk.page }}>
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <PageHeader
          title="Deals Dashboard"
          subtitle="Drag deals across pipeline stages. Financial metrics are displayed on each card."
          totalCount={dealReports.length}
          theme={theme}
        />

        {/* Summary strip */}
        {dealReports.length > 0 && (
          <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
            {[
              { label: "Total Pipeline", value: fmt(totalPurchase), color: tk.text },
              { label: "Total Projected Profit", value: fmt(totalProfit), color: totalProfit > 0 ? "#10b981" : "#ef4444" },
              { label: "Deals Tracked", value: dealReports.length, color: tk.accent },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "14px 20px", flex: "1 1 160px" }}>
                <div style={{ fontSize: 11, color: tk.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4, fontFamily: "'Inter', sans-serif" }}>{label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ color: tk.muted, fontFamily: "'Inter', sans-serif", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Loading deals...
          </div>
        ) : (
          <KanbanBoard
            reports={reports}
            setReports={setReports}
            user={user}
            theme={theme}
            onLoadReport={onLoadReport}
            CardComponent={DealCard}
            filterFn={r => r.report?.meta?.deal?.purchasePrice}
            emptyIcon="💼"
            emptyText="No deals underwritten"
            emptySubtext="Add purchase price in the Deal tab of a report to see it here."
          />
        )}
      </div>
    </div>
  );
}

// ── Confidence Page ───────────────────────────────────────────────────────────

export function ConfidencePage({ user, theme, onLoadReport }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const tk = t(theme);

  useEffect(() => {
    fetchAllReports(user).then((res) => {
      setReports(res.filter((r) => r.report?.meta?.compConfidence));
      setLoading(false);
    });
  }, [user]);

  return (
    <div style={{ padding: "36px 24px", minHeight: "100%", background: tk.page }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <PageHeader title="Data Confidence" subtitle="Review the AI's confidence scores across all your valuations." totalCount={reports.length} theme={theme} />
        {loading ? (
          <div style={{ color: tk.muted }}>Loading data...</div>
        ) : reports.length === 0 ? (
          <div style={{ background: tk.panel, padding: 40, borderRadius: 16, textAlign: "center", border: `1px solid ${tk.border}` }}>
            <div style={{ color: tk.text, fontWeight: 600 }}>No reports with confidence data yet.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {reports.map((r, i) => {
              const conf = r.report.meta.compConfidence;
              const scoreColor = conf.score >= 75 ? "#10b981" : conf.score >= 50 ? "#c9a84c" : "#ef4444";
              return (
                <div key={i} onClick={() => onLoadReport(r)} style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: 16, display: "flex", gap: 20, alignItems: "center", cursor: "pointer", transition: "transform 0.18s" }}
                  onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "none"}
                >
                  <div style={{ width: 62, height: 62, borderRadius: "50%", border: `3px solid ${scoreColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: "bold", color: scoreColor, flexShrink: 0, background: `${scoreColor}11` }}>
                    {conf.score}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: tk.text, marginBottom: 6, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{r.address}</div>
                    <div style={{ fontSize: 12, color: tk.muted, display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(conf.reasons || []).map((reason, j) => (
                        <span key={j} style={{ background: tk.bg, padding: "2px 8px", borderRadius: 4, border: `1px solid ${tk.border}` }}>{reason}</span>
                      ))}
                    </div>
                  </div>
                  <button style={{ background: tk.bg, border: `1px solid ${tk.border}`, color: tk.text, padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>Open →</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Actions Page ──────────────────────────────────────────────────────────────

export function ActionsPage({ user, theme, onLoadReport }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);
  const tk = t(theme);

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
    setCopied(reportId);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div style={{ padding: "36px 24px", minHeight: "100%", background: tk.page }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <PageHeader title="Recent Actions & Reports" subtitle="Quickly export, share, or re-open your saved reports." totalCount={reports.length} theme={theme} />
        {loading ? (
          <div style={{ color: tk.muted }}>Loading actions...</div>
        ) : reports.length === 0 ? (
          <div style={{ background: tk.panel, padding: 40, borderRadius: 16, textAlign: "center", border: `1px solid ${tk.border}` }}>
            <div style={{ color: tk.text, fontWeight: 700 }}>No reports saved yet.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {reports.map((r, i) => (
              <div key={i} onClick={() => onLoadReport(r)} style={{ background: tk.panel, border: `1px solid ${tk.border}`, borderRadius: 12, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", transition: "transform 0.18s" }}
                onMouseEnter={e => e.currentTarget.style.transform = "translateY(-2px)"}
                onMouseLeave={e => e.currentTarget.style.transform = "none"}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: tk.text, marginBottom: 3, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{r.address}</div>
                  <div style={{ fontSize: 12, color: tk.muted }}>
                    {new Date(r.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · {r.report?.meta?.pipelineStatus || "New Lead"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }} onClick={e => e.stopPropagation()}>
                  {r.isCloud && (
                    <button onClick={(e) => copyShareLink(e, r.id)} style={{ background: tk.bg, border: `1px solid ${tk.border}`, color: copied === r.id ? "#10b981" : tk.text, padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12, transition: "all .2s" }}>
                      {copied === r.id ? "✓ Copied!" : "Copy Link"}
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); window.print(); }} style={{ background: tk.bg, border: `1px solid ${tk.border}`, color: tk.text, padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12 }}>Export PDF</button>
                  <button onClick={() => onLoadReport(r)} style={{ background: "linear-gradient(135deg,#c9a84c,#e8c97a)", border: "none", color: "#0c0e13", fontWeight: 700, padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12 }}>Open</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
