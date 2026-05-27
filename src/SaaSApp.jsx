import React, { useEffect, useState } from "react";
import App from "../PropertyValuationBot.jsx";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

function AuthScreen({ theme, setTheme }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const styles = getThemeStyles(theme);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const action =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error } = await action;
    setLoading(false);
    if (error) setMessage(error.message);
    else if (mode === "signup") setMessage("Account created. Check your email if confirmation is enabled.");
  }

  if (!isSupabaseConfigured) {
    return (
      <div style={styles.screen}>
        <div style={styles.panel}>
          <h1 style={styles.title}>PropVal</h1>
          <p style={styles.copy}>Supabase is not configured. Add your Supabase URL and publishable key to .env, then restart the dev server.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.screen}>
      <form onSubmit={submit} style={styles.panel}>
        <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:10 }}>
          <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} style={styles.smallButton}>
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
        <div style={{ fontSize:11, letterSpacing:2, color:"#c9a84c", textTransform:"uppercase", marginBottom:8 }}>Property Valuation SaaS</div>
        <h1 style={styles.title}>{mode === "signin" ? "Sign in" : "Create account"}</h1>
        <p style={styles.copy}>Create polished valuation lead reports, save client history, and manage property analysis from one workspace.</p>
        <input style={styles.input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input style={styles.input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        {message && <div style={{ color: message.includes("created") ? "#64c878" : "#e07060", fontSize:12, marginBottom:12 }}>{message}</div>}
        <button disabled={loading} style={styles.button}>{loading ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}</button>
        <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} style={styles.linkButton}>
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEmail("demo@propval.local");
            setPassword("Demo123456!");
          }}
          style={{ ...styles.linkButton, marginTop:10, color:"#c9a84c" }}
        >
          Use demo credentials
        </button>
      </form>
    </div>
  );
}

export default function SaaSApp() {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("propval:theme") || "dark");
  const [view, setView] = useState("app");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    localStorage.setItem("propval:theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setView("app");
      setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.access_token) {
      setIsAdmin(false);
      return;
    }
    fetch("/api/admin/status", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((res) => res.json())
      .then((payload) => setIsAdmin(Boolean(payload.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, [session?.access_token]);

  const styles = getThemeStyles(theme);
  if (!ready) return <div style={styles.screen}><div style={styles.copy}>Loading...</div></div>;
  if (!session) return <AuthScreen theme={theme} setTheme={setTheme} />;

  return (
    <div style={theme === "light" ? { background:"#f4f0e8", minHeight:"100vh" } : undefined}>
      <style>{responsiveShellCss}</style>
      <div className="account-bar" style={styles.accountBar}>
        <span className="account-email">{session.user.email}</span>
        <span style={{ color: theme === "light" ? "#7a6c58" : "#4a4840" }}>Free plan</span>
        {isAdmin && (
          <button onClick={() => setView(view === "admin" ? "app" : "admin")} style={styles.smallButton}>
            {view === "admin" ? "Valuation app" : "Admin"}
          </button>
        )}
        <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} style={styles.smallButton}>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button onClick={() => supabase.auth.signOut()} style={styles.smallButton}>Sign out</button>
      </div>
      {view === "admin" && isAdmin ? (
        <AdminDashboard session={session} theme={theme} />
      ) : (
        <div style={theme === "light" ? lightModeAppStyle : undefined}>
          <App user={session.user} theme={theme} setTheme={setTheme} onSignOut={() => supabase.auth.signOut()} />
        </div>
      )}
    </div>
  );
}

function AdminDashboard({ session, theme }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const styles = getAdminStyles(theme);

  async function loadAdmin() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/overview", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load admin dashboard.");
      setData(payload);
    } catch (err) {
      setError(err.message || "Unable to load admin dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAdmin();
  }, [session.access_token]);

  return (
    <main style={styles.screen}>
      <div className="admin-header" style={styles.header}>
        <div>
          <div style={styles.kicker}>Admin Console</div>
          <h1 style={styles.title}>Users, searches, and pipeline metrics</h1>
        </div>
        <button onClick={loadAdmin} disabled={loading} style={styles.refreshButton}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}
      {loading && !data && <div style={styles.empty}>Loading admin data...</div>}

      {data && (
        <>
          <section style={styles.metricGrid}>
            <Metric label="Users" value={data.metrics.totalUsers} styles={styles} />
            <Metric label="Searches" value={data.metrics.totalSearches} styles={styles} />
            <Metric label="Last 24 hours" value={data.metrics.searchesLast24h} styles={styles} />
            <Metric label="Active users" value={data.metrics.activeUsers} styles={styles} />
            <Metric label="Average score" value={data.metrics.averageScore ?? "—"} styles={styles} />
            <Metric label="Pipeline value" value={money(data.metrics.totalValuation)} styles={styles} />
          </section>

          <section style={styles.section}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Users</h2>
              <span style={styles.muted}>{data.users.length} total</span>
            </div>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <Th styles={styles}>Email</Th>
                    <Th styles={styles}>Plan</Th>
                    <Th styles={styles}>Searches</Th>
                    <Th styles={styles}>Avg score</Th>
                    <Th styles={styles}>Last search</Th>
                    <Th styles={styles}>Joined</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((user) => (
                    <tr key={user.id}>
                      <Td styles={styles}>{user.email}</Td>
                      <Td styles={styles}>{user.plan}</Td>
                      <Td styles={styles}>{user.searchCount}</Td>
                      <Td styles={styles}>{user.avgScore ?? "—"}</Td>
                      <Td styles={styles}>{dateTime(user.lastSearchAt)}</Td>
                      <Td styles={styles}>{dateTime(user.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={styles.section}>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Recent Property Searches</h2>
              <span style={styles.muted}>Latest {data.recentSearches.length}</span>
            </div>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <Th styles={styles}>Address</Th>
                    <Th styles={styles}>User</Th>
                    <Th styles={styles}>Lead</Th>
                    <Th styles={styles}>Rehab</Th>
                    <Th styles={styles}>Status</Th>
                    <Th styles={styles}>Valuation</Th>
                    <Th styles={styles}>Score</Th>
                    <Th styles={styles}>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSearches.map((search) => (
                    <tr key={search.id}>
                      <Td styles={styles}>{search.address}</Td>
                      <Td styles={styles}>{search.userEmail}</Td>
                      <Td styles={styles}>{search.lead?.name || search.lead?.email || "-"}</Td>
                      <Td styles={styles}>{search.rehabStyle || "—"}</Td>
                      <Td styles={styles}>{search.pipelineStatus || "New Lead"}</Td>
                      <Td styles={styles}>{money(search.valuation || search.estimate)}</Td>
                      <Td styles={styles}>{search.score ?? "-"}{search.compConfidence ? ` / C${search.compConfidence}` : ""}</Td>
                      <Td styles={styles}>{dateTime(search.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.recentSearches.length && <div style={styles.empty}>No property searches yet.</div>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Metric({ label, value, styles }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

function Th({ children, styles }) {
  return <th style={styles.th}>{children}</th>;
}

function Td({ children, styles }) {
  return <td style={styles.td}>{children}</td>;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return "$" + Math.round(n).toLocaleString();
}

function dateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
}

const lightModeAppStyle = {
  filter: "invert(1) hue-rotate(180deg)",
  background: "#f4f0e8",
  minHeight: "100vh",
};

const responsiveShellCss = `
  @media (max-width: 720px) {
    .account-bar {
      justify-content: flex-start !important;
      flex-wrap: wrap !important;
      gap: 8px !important;
      padding: 10px 12px !important;
    }
    .account-email {
      width: 100% !important;
      overflow-wrap: anywhere !important;
    }
    .admin-header {
      flex-direction: column !important;
      align-items: stretch !important;
    }
  }
`;

function getAdminStyles(theme) {
  const light = theme === "light";
  return {
    screen: { minHeight:"100vh", background: light ? "#f4f0e8" : "#0c0e13", color: light ? "#201b14" : "#f0e8d8", padding:"clamp(18px,4vw,34px) clamp(12px,4vw,28px) 60px", fontFamily:"Inter, ui-sans-serif, system-ui, sans-serif" },
    header: { maxWidth:1180, margin:"0 auto 24px", display:"flex", justifyContent:"space-between", gap:16, alignItems:"flex-start" },
    kicker: { fontSize:11, letterSpacing:2, textTransform:"uppercase", color:"#c9a84c", marginBottom:8, fontWeight:700 },
    title: { margin:0, fontSize:32, fontWeight:650, letterSpacing:0, lineHeight:1.15 },
    refreshButton: { background:"linear-gradient(135deg,#c9a84c,#e8c97a)", border:"none", borderRadius:8, color:"#0c0e13", padding:"10px 14px", fontWeight:700, cursor:"pointer" },
    error: { maxWidth:1180, margin:"0 auto 18px", background: light ? "#fff0ed" : "rgba(200,70,50,.12)", border:`1px solid ${light ? "#efc4bb" : "rgba(224,112,96,.35)"}`, color: light ? "#9b2c1f" : "#e07060", borderRadius:8, padding:"12px 14px", fontSize:13 },
    empty: { maxWidth:1180, margin:"18px auto", color: light ? "#6d6254" : "#8a8174", fontSize:13 },
    metricGrid: { maxWidth:1180, margin:"0 auto 22px", display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12 },
    metric: { background: light ? "#ffffff" : "#13161d", border:`1px solid ${light ? "#ded6c8" : "#222530"}`, borderRadius:8, padding:"16px 18px" },
    metricLabel: { color: light ? "#6d6254" : "#8a8174", fontSize:12, marginBottom:8 },
    metricValue: { fontSize:25, fontWeight:700, color: light ? "#201b14" : "#f0e8d8" },
    section: { maxWidth:1180, margin:"0 auto 22px", background: light ? "#ffffff" : "#13161d", border:`1px solid ${light ? "#ded6c8" : "#222530"}`, borderRadius:8, overflow:"hidden" },
    sectionHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"16px 18px", borderBottom:`1px solid ${light ? "#eee4d4" : "#222530"}` },
    sectionTitle: { margin:0, fontSize:16, fontWeight:700 },
    muted: { color: light ? "#7a6c58" : "#8a8174", fontSize:12 },
    tableWrap: { overflowX:"auto" },
    table: { width:"100%", borderCollapse:"collapse", minWidth:900 },
    th: { textAlign:"left", color: light ? "#7a6c58" : "#8a8174", fontSize:11, textTransform:"uppercase", letterSpacing:1, padding:"12px 18px", borderBottom:`1px solid ${light ? "#eee4d4" : "#222530"}`, whiteSpace:"nowrap" },
    td: { padding:"13px 18px", borderBottom:`1px solid ${light ? "#f0e8da" : "#1e2028"}`, color: light ? "#31291f" : "#d8d0c0", fontSize:13, verticalAlign:"top" },
  };
}

function getThemeStyles(theme) {
  const light = theme === "light";
  return {
    screen: { minHeight:"100vh", background: light ? "#f4f0e8" : "#07080b", display:"flex", alignItems:"center", justifyContent:"center", padding:24, color: light ? "#201b14" : "#f0e8d8" },
    panel: { width:"100%", maxWidth:420, background: light ? "#ffffff" : "#13161d", border:`1px solid ${light ? "#ded6c8" : "#222530"}`, borderRadius:14, padding:28, boxSizing:"border-box", boxShadow: light ? "0 18px 45px rgba(60,45,20,.08)" : "none" },
    title: { margin:"0 0 10px", fontSize:30, fontWeight:"normal" },
    copy: { color: light ? "#6d6254" : "#8a8174", fontSize:14, lineHeight:1.6, margin:"0 0 20px", fontFamily:"sans-serif" },
    input: { width:"100%", boxSizing:"border-box", background: light ? "#fbf8f2" : "#0d0f14", border:`1px solid ${light ? "#d8cebd" : "#2a2830"}`, borderRadius:9, padding:"12px 14px", color: light ? "#201b14" : "#f0e8d8", marginBottom:12, outline:"none" },
    button: { width:"100%", padding:"12px", background:"linear-gradient(135deg,#c9a84c,#e8c97a)", border:"none", borderRadius:9, color:"#0c0e13", fontWeight:"bold", cursor:"pointer", marginBottom:12 },
    linkButton: { width:"100%", background:"transparent", border:"none", color: light ? "#315f9f" : "#80a8f0", cursor:"pointer", fontSize:12 },
    accountBar: { position:"sticky", top:0, zIndex:50, display:"flex", justifyContent:"flex-end", alignItems:"center", gap:12, padding:"8px 22px", background: light ? "rgba(255,255,255,.92)" : "rgba(7,8,11,.92)", borderBottom:`1px solid ${light ? "#ded6c8" : "#1e2028"}`, color: light ? "#3f352a" : "#9a9080", fontSize:12, fontFamily:"sans-serif" },
    smallButton: { background: light ? "#fffaf0" : "#13161d", border:`1px solid ${light ? "#d8cebd" : "#2a2830"}`, borderRadius:7, color:"#9b7624", padding:"6px 10px", cursor:"pointer", fontSize:12 },
  };
}
