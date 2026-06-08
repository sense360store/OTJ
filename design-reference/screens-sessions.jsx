/* ============================================================
   Sessions list + Session Planner
   ============================================================ */
(function () {
const { useState, useMemo, useEffect, useRef } = React;
const I = window.Icon;
const OTJ = window.OTJ;

function dateLabel(d) {
  return new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/* ---------------- SESSIONS LIST ---------------- */
function SessionCard({ s, nav }) {
  const mins = OTJ.sessionMinutes(s);
  const phases = [...new Set(s.activities.map((a) => a.phase))];
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="spread">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="pill" style={{ color: "var(--royal)", background: "color-mix(in srgb, var(--royal) 10%, transparent)" }}><I.calendar />{dateLabel(s.date)}</span>
            <span className="pill"><I.clock />{s.time}</span>
          </div>
          <h3 style={{ fontSize: 19 }}>{s.name}</h3>
          <div style={{ color: "var(--gold-600)", fontWeight: 700, fontSize: 14, marginTop: 2 }}>{s.focus}</div>
        </div>
        <div className="avatar" style={{ background: "var(--bg-2)", color: "var(--navy)", fontSize: 13 }}>{s.ageGroup}</div>
      </div>

      <div className="row wrap" style={{ gap: 7 }}>
        <span className="pill"><I.pin />{s.venue}</span>
        <span className="pill"><I.list />{s.activities.length} activities</span>
        <span className="pill"><I.clock />{mins} min</span>
      </div>

      {/* mini timeline */}
      <div style={{ display: "flex", gap: 3, height: 7, borderRadius: 4, overflow: "hidden" }}>
        {s.activities.map((a, i) => (
          <div key={i} title={a.phase} style={{ flex: a.duration, background: PHASE_COLOR[a.phase] }}></div>
        ))}
      </div>

      <div className="row" style={{ gap: 9 }}>
        <button className="btn btn-gold" style={{ flex: 1 }} onClick={() => nav("live", { sessionId: s.id })}><I.play />Start</button>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav("planner", { sessionId: s.id })}><I.edit />Edit plan</button>
      </div>
    </div>
  );
}

function Sessions({ nav, sessions }) {
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Sessions</h2>
          <div className="sub">Your planned training nights — start one live or tweak the plan.</div>
        </div>
        <button className="btn btn-primary" onClick={() => nav("planner")}><I.plus />New session</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))", gap: 18 }}>
        {sessions.map((s) => <SessionCard key={s.id} s={s} nav={nav} />)}
      </div>
    </div>
  );
}

/* ---------------- PLANNER ---------------- */
let DRAFT_SEQ = 100;
function blankSession() {
  return { id: "s" + (DRAFT_SEQ++), name: "New Session", date: "2026-06-16", time: "17:30", ageGroup: "U8s", venue: "Springmill 3G", focus: "All-round", status: "upcoming", activities: [] };
}

function ActivityRow({ act, idx, onRemove, onDur, onPhase, dragHandlers, dragging }) {
  const drill = act.drillId ? OTJ.drillById[act.drillId] : null;
  const media = drill ? OTJ.mediaById[drill.mediaId] : null;
  return (
    <div className="act-card" style={dragging ? { opacity: .4 } : null} draggable {...dragHandlers}>
      <span className="act-grip"><I.grip /></span>
      <div className="act-thumb" style={{ overflow: "hidden" }}>
        <MediaThumb media={media} showPlay={false} showBadge={false} label="" />
      </div>
      <div className="ac-body">
        <h4>{drill ? drill.title : act.title || "Custom activity"}</h4>
        <div className="ac-sub">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span className="tag-dot" style={{ background: PHASE_COLOR[act.phase] }}></span>{act.phase}
          </span>
          {drill && <span>{drill.skill}</span>}
        </div>
      </div>
      <select value={act.phase} onChange={(e) => onPhase(idx, e.target.value)}
        style={{ height: 34, borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg)", fontSize: 12.5, fontWeight: 700, color: "var(--ink)", padding: "0 6px" }}>
        {OTJ.PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <div className="row" style={{ gap: 4 }}>
        <input type="number" value={act.duration} min="1" max="90" onChange={(e) => onDur(idx, parseInt(e.target.value) || 0)}
          style={{ width: 52, height: 34, borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg)", textAlign: "center", fontWeight: 800, fontSize: 13, color: "var(--ink)" }} />
        <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>min</span>
      </div>
      <button className="act-x" onClick={() => onRemove(idx)}><I.trash /></button>
    </div>
  );
}

function Planner({ nav, sessions, upsertSession, editId }) {
  const existing = editId ? sessions.find((s) => s.id === editId) : null;
  const [session, setSession] = useState(() => existing ? JSON.parse(JSON.stringify(existing)) : blankSession());
  const [addOpen, setAddOpen] = useState(false);
  const dragFrom = useRef(null);
  const [dragIdx, setDragIdx] = useState(null);

  // keep in sync if editId changes
  useEffect(() => {
    if (existing) setSession(JSON.parse(JSON.stringify(existing)));
  }, [editId]);

  const mins = session.activities.reduce((a, x) => a + (x.duration || 0), 0);
  const setField = (k, v) => setSession((s) => ({ ...s, [k]: v }));
  const removeAct = (i) => setSession((s) => ({ ...s, activities: s.activities.filter((_, j) => j !== i) }));
  const setDur = (i, v) => setSession((s) => { const a = [...s.activities]; a[i] = { ...a[i], duration: v }; return { ...s, activities: a }; });
  const setPhase = (i, v) => setSession((s) => { const a = [...s.activities]; a[i] = { ...a[i], phase: v }; return { ...s, activities: a }; });
  const addActivities = (items) => setSession((s) => ({ ...s, activities: [...s.activities, ...items] }));

  const reorder = (to) => {
    const from = dragFrom.current;
    if (from === null || from === to) return;
    setSession((s) => {
      const a = [...s.activities];
      const [m] = a.splice(from, 1);
      a.splice(to, 0, m);
      return { ...s, activities: a };
    });
    dragFrom.current = to;
  };

  const save = () => { upsertSession(session); nav("sessions"); };
  const start = () => { upsertSession(session); nav("live", { sessionId: session.id }); };

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn btn-quiet btn-sm" style={{ marginBottom: 8, marginLeft: -8 }} onClick={() => nav("sessions")}><I.chevL />Sessions</button>
          <h2>{existing ? "Edit session" : "Plan a session"}</h2>
          <div className="sub">Drag to reorder · pull drills from the library or start from a template.</div>
        </div>
      </div>

      <div className="planner">
        <div className="timeline-wrap">
          {session.activities.length === 0 ? (
            <div className="card" style={{ padding: 0 }}>
              <Empty icon={I.layers} title="Empty session">Add drills from the library or load a template to get started.</Empty>
            </div>
          ) : (
            <div className="timeline">
              {session.activities.map((act, i) => (
                <ActivityRow key={i} act={act} idx={i}
                  onRemove={removeAct} onDur={setDur} onPhase={setPhase} dragging={dragIdx === i}
                  dragHandlers={{
                    onDragStart: () => { dragFrom.current = i; setDragIdx(i); },
                    onDragEnter: () => reorder(i),
                    onDragEnd: () => { dragFrom.current = null; setDragIdx(null); },
                    onDragOver: (e) => e.preventDefault(),
                  }} />
              ))}
            </div>
          )}
          <div className="row" style={{ gap: 10, marginTop: 4 }}>
            <button className="add-slot" style={{ marginBottom: 0 }} onClick={() => setAddOpen(true)}><I.plus />Add from library</button>
            <button className="add-slot" style={{ marginBottom: 0 }} onClick={() => addActivities([{ phase: "Skill", title: "Custom activity", duration: 10 }])}><I.edit />Add custom</button>
          </div>
        </div>

        <div className="planner-side">
          <div className="card side-card">
            <div className="total-time" style={{ marginBottom: 4 }}>
              <span className="big">{mins}</span><span className="muted" style={{ fontWeight: 700 }}>min total</span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>{session.activities.length} activities</div>
            <div className="field"><label>Session name</label><input value={session.name} onChange={(e) => setField("name", e.target.value)} /></div>
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1 }}><label>Date</label><input type="date" value={session.date} onChange={(e) => setField("date", e.target.value)} /></div>
              <div className="field" style={{ width: 110 }}><label>Time</label><input type="time" value={session.time} onChange={(e) => setField("time", e.target.value)} /></div>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="field" style={{ flex: 1 }}><label>Age group</label>
                <select value={session.ageGroup} onChange={(e) => setField("ageGroup", e.target.value)}>{["U6s","U7s","U8s","U9s","U10s","U11s","U12s"].map((a)=><option key={a}>{a}</option>)}</select>
              </div>
              <div className="field" style={{ flex: 1 }}><label>Venue</label><input value={session.venue} onChange={(e) => setField("venue", e.target.value)} /></div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}><label>Focus</label><input value={session.focus} onChange={(e) => setField("focus", e.target.value)} /></div>
          </div>

          <div className="card side-card" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <button className="btn btn-gold btn-block" disabled={!session.activities.length} onClick={start}><I.play />Start session</button>
            <button className="btn btn-primary btn-block" onClick={save}><I.check />Save session</button>
            <button className="btn btn-ghost btn-block" onClick={() => nav("templates")}><I.book />Load a template</button>
          </div>
        </div>
      </div>

      {addOpen && <AddDrillModal onClose={() => setAddOpen(false)} onAdd={(items) => { addActivities(items); setAddOpen(false); }} />}
    </div>
  );
}

/* ---------------- ADD DRILL MODAL ---------------- */
function AddDrillModal({ onClose, onAdd }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState({});
  const list = OTJ.drills.filter((d) => !q || (d.title + d.skill + d.tags.join(" ")).toLowerCase().includes(q.toLowerCase()));
  const count = Object.values(picked).filter(Boolean).length;
  const phaseFor = (corner) => corner === "physical" ? "Warm-Up" : corner === "social" ? "Game" : "Skill";
  const confirm = () => {
    const items = OTJ.drills.filter((d) => picked[d.id]).map((d) => ({ phase: phaseFor(d.corner), drillId: d.id, duration: d.duration }));
    onAdd(items);
  };
  return (
    <Modal title="Add from library" sub="Select drills to drop into your session" onClose={onClose} wide
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!count} onClick={confirm}><I.plus />Add {count || ""} drill{count !== 1 ? "s" : ""}</button></>}>
      <div className="search-lg" style={{ marginBottom: 16 }}>
        <I.search /><input placeholder="Search drills…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {list.map((d) => {
          const media = OTJ.mediaById[d.mediaId];
          const on = !!picked[d.id];
          return (
            <button key={d.id} onClick={() => setPicked((p) => ({ ...p, [d.id]: !p[d.id] }))}
              style={{ display: "flex", gap: 11, alignItems: "center", textAlign: "left", padding: 9, borderRadius: 12,
                border: "1.5px solid " + (on ? "var(--navy)" : "var(--line)"), background: on ? "color-mix(in srgb, var(--navy) 5%, var(--card))" : "var(--card)", cursor: "pointer" }}>
              <div style={{ width: 58, height: 40, borderRadius: 8, overflow: "hidden", flex: "0 0 58px" }}>
                <MediaThumb media={media} showPlay={false} showBadge={false} label="" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{d.skill} · {d.duration}m</div>
              </div>
              <span style={{ width: 22, height: 22, borderRadius: 7, flex: "0 0 22px", display: "grid", placeItems: "center",
                background: on ? "var(--navy)" : "transparent", border: "1.5px solid " + (on ? "var(--navy)" : "var(--line)"), color: "#fff" }}>
                {on && <I.check style={{ width: 14, height: 14 }} />}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

window.Sessions = Sessions;
window.Planner = Planner;
window.AddDrillModal = AddDrillModal;
})();
