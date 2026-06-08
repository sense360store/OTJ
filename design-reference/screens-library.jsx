/* ============================================================
   Drill Library + Drill Detail
   ============================================================ */
(function () {
const { useState, useMemo, useEffect } = React;
const I = window.Icon;
const OTJ = window.OTJ;
const { CORNERS, SKILLS, AGES, LEVELS } = OTJ;

/* ---------------- LIBRARY ---------------- */
function Library({ nav, preset, clearPreset }) {
  const [q, setQ] = useState("");
  const [corner, setCorner] = useState(preset?.corner || null);
  const [skill, setSkill] = useState("");
  const [age, setAge] = useState("");
  const [level, setLevel] = useState("");
  const [sort, setSort] = useState("recent");

  useEffect(() => { if (preset?.corner) { setCorner(preset.corner); clearPreset(); } }, []);

  const results = useMemo(() => {
    let r = OTJ.drills.filter((d) => {
      if (corner && d.corner !== corner) return false;
      if (skill && d.skill !== skill) return false;
      if (age && !d.ages.includes(age)) return false;
      if (level && d.level !== level) return false;
      if (q) {
        const hay = (d.title + " " + d.summary + " " + d.skill + " " + d.tags.join(" ")).toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    if (sort === "duration") r = [...r].sort((a, b) => a.duration - b.duration);
    if (sort === "az") r = [...r].sort((a, b) => a.title.localeCompare(b.title));
    return r;
  }, [q, corner, skill, age, level, sort]);

  const activeFilters = [corner, skill, age, level].filter(Boolean).length;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Drill Library</h2>
          <div className="sub">Every drill and skill, tagged to the FA four-corner model.</div>
        </div>
        <button className="btn btn-primary" onClick={() => nav("planner")}><I.plus />Build a session</button>
      </div>

      <div className="filterbar">
        <div className="filter-row">
          <div className="search-lg">
            <I.search />
            <input placeholder="Search drills, skills or tags…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Sort: Recent</option>
            <option value="az">Sort: A–Z</option>
            <option value="duration">Sort: Shortest</option>
          </select>
        </div>

        <div className="filter-row">
          <span className="filter-label">Corner</span>
          {Object.values(CORNERS).map((c) => (
            <Chip key={c.key} on={corner === c.key} dot={c.color}
              onClick={() => setCorner(corner === c.key ? null : c.key)}>{c.label}</Chip>
          ))}
        </div>

        <div className="filter-row">
          <span className="filter-label">Refine</span>
          <select className="select" value={skill} onChange={(e) => setSkill(e.target.value)} style={{ height: 40 }}>
            <option value="">All skills</option>
            {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="select" value={age} onChange={(e) => setAge(e.target.value)} style={{ height: 40 }}>
            <option value="">All ages</option>
            {AGES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="select" value={level} onChange={(e) => setLevel(e.target.value)} style={{ height: 40 }}>
            <option value="">All levels</option>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {activeFilters > 0 && (
            <button className="btn btn-quiet btn-sm" onClick={() => { setCorner(null); setSkill(""); setAge(""); setLevel(""); }}>
              <I.x />Clear ({activeFilters})
            </button>
          )}
        </div>
      </div>

      <div className="muted" style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 14 }}>
        {results.length} drill{results.length !== 1 ? "s" : ""}
      </div>

      {results.length === 0 ? (
        <Empty icon={I.search} title="No drills match">Try clearing a filter or searching something broader.</Empty>
      ) : (
        <div className="grid-drills">
          {results.map((d) => <DrillCard key={d.id} drill={d} onClick={() => nav("drill", { drillId: d.id })} />)}
        </div>
      )}
    </div>
  );
}

/* ---------------- DETAIL ---------------- */
function SetupCell({ icon: Ico, k, v }) {
  return (
    <div className="setup-cell">
      <div className="k"><Ico />{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function DrillDetail({ drillId, nav, sessions, upsertSession }) {
  const drill = OTJ.drillById[drillId];
  const [addOpen, setAddOpen] = useState(false);
  if (!drill) return <Empty icon={I.grid} title="Drill not found">It may have been removed.</Empty>;
  const media = OTJ.mediaById[drill.mediaId];
  const c = CORNERS[drill.corner];
  const related = OTJ.drills.filter((d) => d.id !== drill.id && (d.corner === drill.corner || d.skill === drill.skill)).slice(0, 3);

  return (
    <div>
      <button className="btn btn-quiet btn-sm" style={{ marginBottom: 16 }} onClick={() => nav("library")}>
        <I.chevL />Back to library
      </button>

      <div className="detail-grid">
        <div>
          <div className="detail-media">
            <div className="player">
              <MediaThumb media={media} label={media ? undefined : "no media yet"} />
            </div>
          </div>
          {media && (
            <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="pill" style={{ color: MEDIA_META[media.type].color }}>
                  {React.createElement(MEDIA_META[media.type].icon)} {MEDIA_META[media.type].label}
                </span>
                <span className="muted" style={{ fontSize: 13 }}>{media.name}</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => nav("media")}><I.external />Open</button>
            </div>
          )}

          <hr className="divider" />
          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Coaching points</h3>
          <div className="coach-points">
            {drill.points.map((p, i) => (
              <div className="cp" key={i}><span className="cp-num">{i + 1}</span><span style={{ fontSize: 15, lineHeight: 1.45 }}>{p}</span></div>
            ))}
          </div>
        </div>

        <div>
          <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
            <CornerTag corner={drill.corner} />
            <span className="pill">{drill.level}</span>
          </div>
          <h2 style={{ fontSize: 28, lineHeight: 1.1 }}>{drill.title}</h2>
          <p className="muted" style={{ fontSize: 15.5, lineHeight: 1.55, marginTop: 10 }}>{drill.summary}</p>

          <div className="setup-grid" style={{ marginTop: 18 }}>
            <SetupCell icon={I.clock} k="Duration" v={drill.duration + " min"} />
            <SetupCell icon={I.users} k="Players" v={drill.players} />
            <SetupCell icon={I.ruler} k="Area" v={drill.area} />
            <SetupCell icon={I.target} k="Skill" v={drill.skill} />
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="k" style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--slate-2)", display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              <I.cone style={{ width: 13, height: 13 }} />Equipment
            </div>
            <div className="row wrap" style={{ gap: 7 }}>
              {drill.equipment.length ? drill.equipment.map((e) => <span className="pill" key={e}>{e}</span>) : <span className="muted" style={{ fontSize: 13 }}>None needed</span>}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="pill">Ages {drill.ages[0]}–{drill.ages[drill.ages.length - 1]}</span>
              {drill.tags.map((t) => <span className="pill" key={t}>#{t}</span>)}
            </div>
          </div>

          <div className="row" style={{ gap: 10, marginTop: 22 }}>
            <button className="btn btn-primary btn-block" onClick={() => setAddOpen(true)}><I.plus />Add to session</button>
          </div>
        </div>
      </div>

      {related.length > 0 && (
        <>
          <hr className="divider" />
          <div className="section-title"><I.layers /><h3>Related drills</h3></div>
          <div className="grid-drills">
            {related.map((d) => <DrillCard key={d.id} drill={d} onClick={() => nav("drill", { drillId: d.id })} />)}
          </div>
        </>
      )}

      {addOpen && <AddToSessionModal drill={drill} sessions={sessions} upsertSession={upsertSession} onClose={() => setAddOpen(false)} nav={nav} />}
    </div>
  );
}

function AddToSessionModal({ drill, sessions, upsertSession, onClose, nav }) {
  const [phase, setPhase] = useState("Skill");
  const [target, setTarget] = useState(sessions[0]?.id || "");
  const add = () => {
    const s = sessions.find((x) => x.id === target);
    if (!s) return;
    const updated = { ...s, activities: [...s.activities, { phase, drillId: drill.id, duration: drill.duration }] };
    upsertSession(updated);
    onClose();
    nav("planner", { sessionId: s.id });
  };
  return (
    <Modal title="Add to session" sub={drill.title} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={add} disabled={!target}><I.plus />Add drill</button></>}>
      <div className="field">
        <label>Choose a session</label>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.name} · {new Date(s.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Add to phase</label>
        <div className="row wrap" style={{ gap: 8 }}>
          {OTJ.PHASES.map((p) => <Chip key={p} on={phase === p} dot={PHASE_COLOR[p]} onClick={() => setPhase(p)}>{p}</Chip>)}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 13.5 }}>Adds <b style={{ color: "var(--ink)" }}>{drill.duration} min</b> to the session.</div>
    </Modal>
  );
}

window.Library = Library;
window.DrillDetail = DrillDetail;
})();
