/* ============================================================
   Ossett Training Hub — shared UI primitives
   ============================================================ */
const { CORNERS, cornerClass } = window.OTJ;
const I = window.Icon;

function fmtMin(m){ return m + " min"; }
function fmtClock(sec){
  const m = Math.floor(sec/60), s = sec%60;
  return m + ":" + String(s).padStart(2,"0");
}

/* ---- Corner tag ------------------------------------------------ */
function CornerTag({ corner, small }) {
  const c = CORNERS[corner]; if (!c) return null;
  return (
    <span className={"tag corner-" + cornerClass[corner]} style={small ? { padding: "2px 7px", fontSize: 11 } : null}>
      <span className="tag-dot" style={{ background: c.color }}></span>
      {c.label}
    </span>
  );
}

/* ---- media type meta ------------------------------------------- */
const MEDIA_META = {
  video:   { label: "Video",   icon: I.video,    color: "var(--m-video)" },
  youtube: { label: "YouTube", icon: I.youtube,  color: "var(--m-youtube)" },
  image:   { label: "Image",   icon: I.image,    color: "var(--m-image)" },
  pdf:     { label: "PDF",     icon: I.fileText, color: "var(--m-pdf)" },
};

/* ---- thumbnail (placeholder art) ------------------------------- */
function MediaThumb({ media, showPlay, showBadge = true, label }) {
  if (!media) {
    return (
      <div className="thumb thumb-diagram">
        <span style={{ color: "var(--slate-2)", fontSize: 12, fontWeight: 700 }}>No media</span>
        <span className="thumb-label">add a clip or diagram</span>
      </div>
    );
  }
  const meta = MEDIA_META[media.type];
  const Ico = meta.icon;
  const kindClass = media.kind === "pitch" ? "thumb-pitch"
    : media.kind === "pdf" ? "thumb-pdf"
    : media.type === "image" ? "thumb-img" : "thumb-diagram";
  const isVideo = media.type === "video" || media.type === "youtube";
  return (
    <div className={"thumb " + kindClass}>
      {isVideo && (showPlay !== false) && (
        <div className="play-btn"><I.play /></div>
      )}
      {!isVideo && media.kind === "pdf" && <I.fileText style={{ width: 34, height: 34, color: "var(--m-pdf)", opacity: .6 }} />}
      {showBadge && (
        <span className="media-badge" style={{ background: meta.color }}><Ico />{meta.label}</span>
      )}
      {showBadge !== false && <span className="thumb-label">{label !== undefined ? label : (media.kind === "pdf" ? "session card" : media.kind === "diagram" ? "drill diagram" : "pitch footage")}</span>}
      {media.length && showBadge !== false && <span className="dur-badge">{media.length}</span>}
    </div>
  );
}

/* ---- pills ----------------------------------------------------- */
function Pill({ icon: Ico, children }) {
  return <span className="pill">{Ico && <Ico />}{children}</span>;
}

/* ---- filter chip ----------------------------------------------- */
function Chip({ on, onClick, dot, icon: Ico, children }) {
  return (
    <button className={"chip" + (on ? " on" : "")} onClick={onClick}>
      {dot && <span className="chip-dot" style={{ background: dot }}></span>}
      {Ico && <Ico />}
      {children}
    </button>
  );
}

/* ---- drill card ------------------------------------------------ */
function DrillCard({ drill, onClick, action }) {
  const media = window.OTJ.mediaById[drill.mediaId];
  const c = CORNERS[drill.corner];
  return (
    <div className="drill-card" onClick={onClick}>
      <div className="dc-corner-strip" style={{ background: c.color }}></div>
      <div style={{ padding: 0 }}>
        <MediaThumb media={media} />
      </div>
      <div className="dc-body">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <CornerTag corner={drill.corner} small />
          <span className="pill"><I.clock />{drill.duration}m</span>
        </div>
        <h3>{drill.title}</h3>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.45, margin: 0,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {drill.summary}
        </p>
        <div className="dc-meta">
          <span className="pill">{drill.skill}</span>
          <span className="pill">{drill.ages[0]}–{drill.ages[drill.ages.length-1]}</span>
        </div>
        {action}
      </div>
    </div>
  );
}

/* ---- modal shell ----------------------------------------------- */
function Modal({ title, sub, onClose, children, footer, wide }) {
  React.useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 860 } : null} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {sub && <p>{sub}</p>}
          </div>
          <button className="icon-btn" onClick={onClose}><I.x /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---- phase color ----------------------------------------------- */
const PHASE_COLOR = { "Warm-Up": "var(--c-physical)", "Skill": "var(--c-technical)", "Game": "var(--c-social)", "Cool-Down": "var(--c-psych)" };

/* ---- empty state ----------------------------------------------- */
function Empty({ icon: Ico, title, children }) {
  return (
    <div className="empty">
      {Ico && <Ico />}
      <h3>{title}</h3>
      <p className="muted">{children}</p>
    </div>
  );
}

Object.assign(window, {
  fmtMin, fmtClock, CornerTag, MediaThumb, MEDIA_META, Pill, Chip, DrillCard, Modal, Empty, PHASE_COLOR,
});
