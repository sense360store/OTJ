/* ============================================================
   Templates + Media Library
   ============================================================ */
(function () {
const { useState } = React;
const I = window.Icon;
const OTJ = window.OTJ;

/* ---------------- TEMPLATES ---------------- */
let T_SEQ = 200;

function TemplateCard({ t, nav, upsertSession, onManage }) {
  const mins = t.activities.reduce((a, x) => a + (x.duration || 0), 0);
  const use = () => {
    const s = {
      id: "s" + (T_SEQ++), name: t.name, date: "2026-06-16", time: "17:30",
      ageGroup: "U8s", venue: "Springmill 3G", focus: t.focus, status: "upcoming",
      activities: JSON.parse(JSON.stringify(t.activities)),
    };
    upsertSession(s);
    nav("planner", { sessionId: s.id });
  };
  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h3 style={{ fontSize: 20 }}>{t.name}</h3>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 3 }}>Created by {t.author}</div>
        <span className="tag corner-technical" style={{ marginTop: 9 }}>{t.focus}</span>
      </div>
      <div className="row" style={{ gap: 7 }}>
        <span className="pill"><I.list />{t.activities.length} activities</span>
        <span className="pill"><I.clock />{mins} min</span>
      </div>
      <div style={{ display: "flex", gap: 3, height: 7, borderRadius: 4, overflow: "hidden" }}>
        {t.activities.map((a, i) => <div key={i} style={{ flex: a.duration, background: PHASE_COLOR[a.phase] }} title={a.phase}></div>)}
      </div>
      <div className="row" style={{ gap: 9 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={use}><I.copy />Use template</button>
        <button className="btn btn-ghost btn-sm" onClick={() => onManage(t)}><I.book />Drills</button>
      </div>
    </div>
  );
}

function ManageTemplateModal({ tpl, onClose }) {
  const [acts, setActs] = useState(() => JSON.parse(JSON.stringify(tpl.activities)));
  const [adding, setAdding] = useState(false);
  const mins = acts.reduce((a, x) => a + (x.duration || 0), 0);
  return (
    <Modal title={tpl.name} sub="Manage drills in this template" onClose={onClose}
      footer={<button className="btn btn-primary" onClick={onClose}><I.check />Done</button>}>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="role-badge" style={{ fontSize: 12 }}>{acts.length} activities</span>
          <span className="pill"><I.clock />{mins} min</span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><I.plus />Add from Library</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {acts.map((a, i) => {
          const d = a.drillId ? OTJ.drillById[a.drillId] : null;
          return (
            <div key={i} className="act-card" style={{ marginBottom: 0 }}>
              <span className="act-grip"><I.grip /></span>
              <span className="tag-dot" style={{ background: PHASE_COLOR[a.phase], width: 10, height: 10 }}></span>
              <div className="ac-body">
                <h4>{d ? d.title : a.title}</h4>
                <div className="ac-sub"><span>{a.phase}</span>{d && <span>{d.skill}</span>}</div>
              </div>
              <span className="act-dur">{a.duration} min</span>
              <button className="act-x" onClick={() => setActs((x) => x.filter((_, j) => j !== i))}><I.trash /></button>
            </div>
          );
        })}
      </div>
      {adding && <AddDrillModal onClose={() => setAdding(false)} onAdd={(items) => { setActs((x) => [...x, ...items]); setAdding(false); }} />}
    </Modal>
  );
}

function Templates({ nav, upsertSession }) {
  const [q, setQ] = useState("");
  const [manage, setManage] = useState(null);
  const list = OTJ.templates.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Session Templates</h2>
          <div className="sub">Reusable session shells — build a new plan in one click.</div>
        </div>
        <button className="btn btn-primary" onClick={() => nav("planner")}><I.plus />New template</button>
      </div>
      <div className="search-lg" style={{ maxWidth: 460, marginBottom: 20 }}>
        <I.search /><input placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(310px,1fr))", gap: 18 }}>
        {list.map((t) => <TemplateCard key={t.id} t={t} nav={nav} upsertSession={upsertSession} onManage={setManage} />)}
      </div>
      {manage && <ManageTemplateModal tpl={manage} onClose={() => setManage(null)} />}
    </div>
  );
}

/* ---------------- MEDIA LIBRARY ---------------- */
function MediaCard({ m, onOpen }) {
  const meta = MEDIA_META[m.type];
  const Ico = meta.icon;
  return (
    <div className="card" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <MediaThumb media={m} label={m.kind === "pdf" ? "session card" : m.kind === "diagram" ? "drill diagram" : "pitch footage"} />
      <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
            {m.size || (m.yt ? "YouTube link" : "")}{m.dims ? " · " + m.dims : ""}{m.pages ? " · " + m.pages + " pages" : ""}{m.length ? " · " + m.length : ""}
          </div>
        </div>
        <span className="pill" style={{ alignSelf: "flex-start" }}>
          {m.usedIn > 0 ? `Used in ${m.usedIn} drill${m.usedIn !== 1 ? "s" : ""}` : "Not in use"}
        </span>
        <div className="row" style={{ gap: 8, marginTop: "auto" }}>
          <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={onOpen}><I.external />View</button>
          <button className="btn btn-ghost btn-sm icon-only" style={{ width: 38, padding: 0 }}><I.trash /></button>
        </div>
      </div>
    </div>
  );
}

function MediaLibrary({ nav }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [open, setOpen] = useState(null);
  const list = OTJ.media.filter((m) => (!type || m.type === type) && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
  const counts = { video: 0, youtube: 0, image: 0, pdf: 0 };
  OTJ.media.forEach((m) => counts[m.type]++);
  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Media Library</h2>
          <div className="sub">All your videos, YouTube links, diagrams and PDFs in one place.</div>
        </div>
        <button className="btn btn-primary"><I.upload />Upload media</button>
      </div>

      <div className="filter-row" style={{ marginBottom: 16 }}>
        <div className="search-lg"><I.search /><input placeholder="Search by filename…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          <option value="video">Videos</option>
          <option value="youtube">YouTube</option>
          <option value="image">Images</option>
          <option value="pdf">PDFs</option>
        </select>
      </div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 18 }}>
        <span className="muted" style={{ fontSize: 13.5, fontWeight: 700 }}>Total: {OTJ.media.length}</span>
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} className="pill" style={{ color: MEDIA_META[k].color }}>{React.createElement(MEDIA_META[k].icon)} {MEDIA_META[k].label}: {v}</span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))", gap: 18 }}>
        {list.map((m) => <MediaCard key={m.id} m={m} onOpen={() => setOpen(m)} />)}
      </div>

      {open && (
        <Modal title={open.name} sub={MEDIA_META[open.type].label} onClose={() => setOpen(null)}
          footer={<button className="btn btn-primary" onClick={() => setOpen(null)}>Close</button>}>
          <div className="detail-media"><div className="player"><MediaThumb media={open} /></div></div>
          <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
            {open.size && <span className="pill">{open.size}</span>}
            {open.dims && <span className="pill">{open.dims}</span>}
            {open.length && <span className="pill"><I.clock />{open.length}</span>}
            {open.pages && <span className="pill"><I.fileText />{open.pages} pages</span>}
            <span className="pill">{open.usedIn > 0 ? `Used in ${open.usedIn} drill(s)` : "Not in use"}</span>
          </div>
        </Modal>
      )}
    </div>
  );
}

window.Templates = Templates;
window.MediaLibrary = MediaLibrary;
})();
