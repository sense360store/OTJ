/* ============================================================
   Home / Dashboard
   ============================================================ */
(function () {
const I = window.Icon;
const OTJ = window.OTJ;
const { CORNERS } = OTJ;

const CORNER_ICONS = { technical: I.target, physical: I.dumbbell, social: I.handshake, psychological: I.brain };

function NextSessionHero({ session, nav }) {
  const mins = OTJ.sessionMinutes(session);
  const d = new Date(session.date + "T" + session.time);
  const dayStr = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="hero">
      <div className="eyebrow">Your next session</div>
      <h2>{session.name}</h2>
      <div style={{ fontWeight: 700, color: "var(--gold)", fontSize: 15 }}>{session.focus}</div>
      <div className="hero-meta">
        <span className="row"><I.calendar />{dayStr}</span>
        <span className="row"><I.clock />{session.time} · {mins} min</span>
        <span className="row"><I.pin />{session.venue}</span>
        <span className="row"><I.list />{session.activities.length} activities</span>
      </div>
      <div className="hero-acts">
        <button className="btn btn-gold btn-lg" onClick={() => nav("live", { sessionId: session.id })}>
          <I.play />Start session
        </button>
        <button className="btn btn-ghost btn-lg" style={{ background: "rgba(255,255,255,.12)", color: "#fff", borderColor: "rgba(255,255,255,.25)" }}
          onClick={() => nav("planner", { sessionId: session.id })}>
          <I.edit />Open plan
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, val, foot, icon: Ico, onClick }) {
  return (
    <div className="card stat" style={onClick ? { cursor: "pointer" } : null} onClick={onClick}>
      <div className="spread">
        <span className="label">{label}</span>
        <Ico className="ico" />
      </div>
      <div className="val">{val}</div>
      <div className="foot">{foot}</div>
    </div>
  );
}

function Home({ nav, sessions, goCorner }) {
  const next = sessions[0];
  const recent = OTJ.drills.slice(0, 4);
  const cornerCounts = {};
  OTJ.drills.forEach((d) => { cornerCounts[d.corner] = (cornerCounts[d.corner] || 0) + 1; });

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="eyebrow">Tuesday · 6 June 2026</div>
          <h2 style={{ marginTop: 4 }}>Welcome back, Sarah</h2>
          <div className="sub">Plan a session, browse the drill library, or jump straight onto the pitch.</div>
        </div>
        <div className="row">
          <button className="btn btn-ghost" onClick={() => nav("library")}><I.search />Browse drills</button>
          <button className="btn btn-primary" onClick={() => nav("planner")}><I.plus />New session</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 18, alignItems: "stretch", marginBottom: 18 }} className="home-top">
        <NextSessionHero session={next} nav={nav} />
        <div className="stat-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <StatCard label="Drills" val={OTJ.drills.length} foot="In the library" icon={I.grid} onClick={() => nav("library")} />
          <StatCard label="Templates" val={OTJ.templates.length} foot="Ready to use" icon={I.book} onClick={() => nav("templates")} />
          <StatCard label="Sessions" val={sessions.length} foot="Planned ahead" icon={I.calendar} onClick={() => nav("sessions")} />
          <StatCard label="Media" val={OTJ.media.length} foot="Clips · PDFs · images" icon={I.film} onClick={() => nav("media")} />
        </div>
      </div>

      {/* Browse by corner */}
      <div className="section-title"><I.sparkle /><h3>Browse by FA corner</h3></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14, marginBottom: 28 }}>
        {Object.values(CORNERS).map((c) => {
          const Ico = CORNER_ICONS[c.key];
          return (
            <button key={c.key} className="card" onClick={() => goCorner(c.key)}
              style={{ padding: 16, textAlign: "left", border: "1px solid var(--line)", cursor: "pointer", display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center",
                background: "color-mix(in srgb, " + c.color + " 14%, transparent)", color: c.color }}>
                <Ico style={{ width: 22, height: 22 }} />
              </span>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{c.label}</div>
                <div className="muted" style={{ fontSize: 13 }}>{cornerCounts[c.key] || 0} drills</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Recently added */}
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="section-title" style={{ margin: 0 }}><I.bolt /><h3>Recently added</h3></div>
        <button className="btn btn-quiet btn-sm" onClick={() => nav("library")}>View all<I.arrowRight /></button>
      </div>
      <div className="grid-drills">
        {recent.map((d) => <DrillCard key={d.id} drill={d} onClick={() => nav("drill", { drillId: d.id })} />)}
      </div>
    </div>
  );
}

window.Home = Home;
window.CORNER_ICONS = CORNER_ICONS;
})();
