/* ============================================================
   Ossett Training Hub — App shell, nav, routing
   ============================================================ */
const { useState, useEffect, useMemo, useRef } = React;
const OTJ = window.OTJ;
const I = window.Icon;

const CREST = "https://www.ossetttownjnr.com/imgs/Club_Logo_Transparent.png";

function Crest({ className = "crest" }) {
  const [err, setErr] = useState(false);
  if (err) return <div className="crest-fallback">OTJ</div>;
  return <img src={CREST} alt="Ossett Town Juniors crest" className={className} onError={() => setErr(true)} />;
}

const NAV = [
  { group: null, items: [{ id: "home", label: "Home", icon: I.home }] },
  { group: "Plan", items: [
    { id: "library", label: "Drill Library", icon: I.grid, badge: String(OTJ.drills.length) },
    { id: "sessions", label: "Sessions", icon: I.calendar },
    { id: "planner", label: "Session Planner", icon: I.layers },
  ]},
  { group: "Content", items: [
    { id: "templates", label: "Templates", icon: I.book },
    { id: "media", label: "Media Library", icon: I.film },
  ]},
];

function Sidebar({ screen, nav, dark, setDark }) {
  const isActive = (id) => screen === id
    || (id === "library" && screen === "drill")
    || (id === "planner" && screen === "planner");
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <Crest />
        <div>
          <h1>Ossett Town Juniors</h1>
          <p>Training Hub</p>
        </div>
      </div>
      <div className="sb-tag">
        <em>"Where football and friendships flourish"</em>
        <span className="sb-accred"><I.star style={{ width: 12, height: 12 }} />FA 2-Star Accredited</span>
      </div>
      <div className="sb-scroll">
        {NAV.map((sec, i) => (
          <div key={i}>
            {sec.group && <div className="sb-section">{sec.group}</div>}
            {sec.items.map((it) => (
              <button key={it.id} className={"nav-item" + (isActive(it.id) ? " active" : "")} onClick={() => nav(it.id)}>
                <it.icon className="nav-ico" />
                {it.label}
                {it.badge && <span className="nav-badge">{it.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="sb-foot">
        <div className="coach-chip">
          <div className="avatar">ST</div>
          <div style={{ flex: 1 }}>
            <b>Sarah Thompson</b>
            <span className="role-badge">Coach</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

const BOTTOM = [
  { id: "home", label: "Home", icon: I.home },
  { id: "library", label: "Drills", icon: I.grid },
  { id: "planner", label: "Plan", icon: I.layers },
  { id: "sessions", label: "Sessions", icon: I.calendar },
  { id: "media", label: "Media", icon: I.film },
];

function BottomNav({ screen, nav }) {
  return (
    <nav className="bottom-nav">
      {BOTTOM.map((it) => {
        const active = screen === it.id || (it.id === "library" && screen === "drill");
        return (
          <button key={it.id} className={"bn-item" + (active ? " active" : "")} onClick={() => nav(it.id)}>
            <it.icon />{it.label}
          </button>
        );
      })}
    </nav>
  );
}

function TopBar({ nav, dark, setDark, onSearch }) {
  return (
    <div className="topbar">
      <div className="topbar-search">
        <I.search />
        <input placeholder="Search drills, skills, media…" onFocus={() => nav("library")} readOnly />
      </div>
      <div className="topbar-spacer"></div>
      <button className="icon-btn" title="Notifications"><I.bell /></button>
      <button className="icon-btn" onClick={() => setDark(!dark)} title="Toggle theme">
        {dark ? <I.sun /> : <I.moon />}
      </button>
      <button className="btn btn-gold" onClick={() => nav("planner")}><I.plus />New Session</button>
    </div>
  );
}

function MobileTop({ dark, setDark }) {
  return (
    <div className="mobile-topbar">
      <Crest />
      <b>Training Hub</b>
      <div style={{ flex: 1 }}></div>
      <button className="icon-btn" onClick={() => setDark(!dark)}>{dark ? <I.sun /> : <I.moon />}</button>
    </div>
  );
}

/* ============================================================ APP */
function App() {
  const [route, setRoute] = useState(() => {
    try { return JSON.parse(localStorage.getItem("otj_route")) || { screen: "home", params: {} }; }
    catch { return { screen: "home", params: {} }; }
  });
  const [dark, setDark] = useState(() => localStorage.getItem("otj_dark") === "1");
  const [sessions, setSessions] = useState(OTJ.sessions);
  const [libPreset, setLibPreset] = useState(null);

  const nav = (screen, params = {}) => {
    setRoute({ screen, params });
    window.scrollTo(0, 0);
  };

  useEffect(() => { localStorage.setItem("otj_route", JSON.stringify(route)); }, [route]);
  useEffect(() => {
    localStorage.setItem("otj_dark", dark ? "1" : "0");
    document.documentElement.classList.toggle("theme-dark", dark);
  }, [dark]);

  const { screen, params } = route;

  // Live mode is full-screen overlay
  if (screen === "live") {
    const session = sessions.find((s) => s.id === params.sessionId) || sessions[0];
    return <LiveSession session={session} onExit={() => nav("sessions")} dark={dark} />;
  }

  const upsertSession = (s) => {
    setSessions((prev) => {
      const i = prev.findIndex((x) => x.id === s.id);
      if (i === -1) return [...prev, s];
      const copy = [...prev]; copy[i] = s; return copy;
    });
  };

  let view;
  switch (screen) {
    case "library":
      view = <Library nav={nav} preset={libPreset} clearPreset={() => setLibPreset(null)} />; break;
    case "drill":
      view = <DrillDetail drillId={params.drillId} nav={nav} sessions={sessions} upsertSession={upsertSession} />; break;
    case "sessions":
      view = <Sessions nav={nav} sessions={sessions} />; break;
    case "planner":
      view = <Planner nav={nav} sessions={sessions} upsertSession={upsertSession} editId={params.sessionId} />; break;
    case "templates":
      view = <Templates nav={nav} upsertSession={upsertSession} />; break;
    case "media":
      view = <MediaLibrary nav={nav} />; break;
    default:
      view = <Home nav={nav} sessions={sessions} goCorner={(c) => { setLibPreset({ corner: c }); nav("library"); }} />;
  }

  return (
    <div className="app">
      <Sidebar screen={screen} nav={nav} dark={dark} setDark={setDark} />
      <div className="main">
        <TopBar nav={nav} dark={dark} setDark={setDark} />
        <MobileTop dark={dark} setDark={setDark} />
        <div className="content">{view}</div>
      </div>
      <BottomNav screen={screen} nav={nav} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
