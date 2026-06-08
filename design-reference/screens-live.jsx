/* ============================================================
   Live / Run Session mode — phone-first touchline screen
   ============================================================ */
(function () {
const { useState, useEffect, useRef } = React;
const I = window.Icon;
const OTJ = window.OTJ;

function lsKey(id) { return "otj_live_" + id; }

function LiveSession({ session, onExit, dark }) {
  const acts = session.activities;
  const load = () => { try { return JSON.parse(localStorage.getItem(lsKey(session.id))); } catch { return null; } };
  const saved = load();

  const [idx, setIdx] = useState(saved?.idx ?? 0);
  const [remaining, setRemaining] = useState(saved?.remaining ?? (acts[saved?.idx ?? 0]?.duration || 0) * 60);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(saved?.elapsed ?? 0);
  const [done, setDone] = useState(saved?.done ?? []);
  const [notes, setNotes] = useState(saved?.notes ?? {});
  const [complete, setComplete] = useState(saved?.complete ?? false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const tick = useRef(null);

  // ensure dark theme inside live mode for touchline contrast (respect user toggle though)
  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => {
        setElapsed((e) => e + 1);
        setRemaining((r) => Math.max(0, r - 1));
      }, 1000);
      return () => clearInterval(tick.current);
    }
  }, [running]);

  // persist
  useEffect(() => {
    localStorage.setItem(lsKey(session.id), JSON.stringify({ idx, remaining, elapsed, done, notes, complete }));
  }, [idx, remaining, elapsed, done, notes, complete]);

  const act = acts[idx];
  const drill = act?.drillId ? OTJ.drillById[act.drillId] : null;
  const media = drill ? OTJ.mediaById[drill.mediaId] : null;
  const total = OTJ.sessionMinutes(session);
  const actSecs = (act?.duration || 0) * 60;
  const frac = actSecs ? 1 - remaining / actSecs : 0;

  const goTo = (i) => {
    if (i < 0 || i >= acts.length) return;
    setIdx(i); setRemaining((acts[i].duration || 0) * 60); setRunning(false);
  };
  const markDoneNext = () => {
    setDone((d) => d.includes(idx) ? d : [...d, idx]);
    if (idx >= acts.length - 1) { setComplete(true); setRunning(false); }
    else goTo(idx + 1);
  };
  const restart = () => {
    localStorage.removeItem(lsKey(session.id));
    setIdx(0); setRemaining((acts[0]?.duration || 0) * 60); setElapsed(0); setDone([]); setNotes({}); setComplete(false); setRunning(false);
  };

  if (complete) return <LiveComplete session={session} elapsed={elapsed} notes={notes} onExit={onExit} onRestart={restart} />;

  return (
    <div className="live theme-dark">
      <div className="live-top">
        <button className="icon-btn" onClick={onExit} title="Exit"><I.x /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ltitle" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session.name}</div>
          <div className="lsub">Activity {idx + 1} of {acts.length} · {session.focus}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="ltitle mono" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtClock(elapsed)}</div>
          <div className="lsub">of ~{total} min</div>
        </div>
      </div>

      <div className="live-progress">
        {acts.map((_, i) => (
          <div key={i} className={"live-seg" + (done.includes(i) ? " done" : i === idx ? " cur" : "")}></div>
        ))}
      </div>

      <div className="live-body">
        <div className="live-stage">
          {/* phase + title */}
          <div style={{ textAlign: "center" }}>
            <span className="tag" style={{ background: "color-mix(in srgb," + PHASE_COLOR[act.phase] + " 20%, transparent)", color: PHASE_COLOR[act.phase], fontSize: 13 }}>
              <span className="tag-dot" style={{ background: PHASE_COLOR[act.phase] }}></span>{act.phase}
            </span>
            <h2 style={{ fontSize: "clamp(26px,6vw,38px)", marginTop: 12 }}>{drill ? drill.title : act.title || "Activity"}</h2>
            {drill && <div className="muted" style={{ fontSize: 15, marginTop: 4 }}>{drill.skill} · {drill.players} · {drill.area}</div>}
          </div>

          {/* timer */}
          <div className="timer-ring">
            <div className={"timer-num" + (remaining <= 30 && remaining > 0 ? " warn" : "")}>{fmtClock(remaining)}</div>
            <div style={{ width: "70%", maxWidth: 300, height: 6, borderRadius: 4, background: "var(--line)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: (frac * 100) + "%", background: remaining <= 30 ? "var(--m-pdf)" : "var(--gold)", transition: "width 1s linear" }}></div>
            </div>
          </div>

          {/* controls */}
          <div className="live-controls">
            <button className="round-btn" onClick={() => goTo(idx - 1)} disabled={idx === 0} title="Previous"><I.skipBack /></button>
            <button className="round-btn play" onClick={() => setRunning((r) => !r)}>{running ? <I.pause /> : <I.play />}</button>
            <button className="round-btn" onClick={() => { setRemaining(actSecs); }} title="Reset timer"><I.rotate /></button>
          </div>

          {/* media */}
          {media && (
            <button onClick={() => setMediaOpen(true)} style={{ border: "1px solid var(--line)", background: "var(--card)", borderRadius: 14, padding: 10, display: "flex", gap: 12, alignItems: "center", cursor: "pointer", textAlign: "left" }}>
              <div style={{ width: 92, height: 58, borderRadius: 9, overflow: "hidden", flex: "0 0 92px" }}><MediaThumb media={media} showPlay={false} showBadge={false} label="" /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{MEDIA_META[media.type].label} · tap to view</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{media.name}</div>
              </div>
              <span style={{ color: "var(--gold)" }}><I.play /></span>
            </button>
          )}

          {/* coaching points */}
          {drill && (
            <div className="live-card" style={{ padding: "16px 18px" }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Coaching points</div>
              <div className="coach-points">
                {drill.points.map((p, i) => <div className="cp" key={i}><span className="cp-num">{i + 1}</span><span style={{ fontSize: 14.5, lineHeight: 1.4 }}>{p}</span></div>)}
              </div>
            </div>
          )}

          {/* quick note */}
          <div className="live-card" style={{ padding: "14px 16px" }}>
            <div className="eyebrow" style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><I.note style={{ width: 14, height: 14 }} />Quick note</div>
            <textarea value={notes[idx] || ""} onChange={(e) => setNotes((n) => ({ ...n, [idx]: e.target.value }))}
              placeholder="Jot what worked, who shone, what to revisit…" rows={2}
              style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg)", color: "var(--ink)", padding: 10, fontFamily: "inherit", fontSize: 14, resize: "vertical" }} />
          </div>

          {/* up next */}
          {idx < acts.length - 1 && (() => {
            const n = acts[idx + 1]; const nd = n.drillId ? OTJ.drillById[n.drillId] : null;
            return (
              <div className="row" style={{ justifyContent: "center", gap: 8, color: "var(--slate)", fontSize: 13.5, fontWeight: 600 }}>
                <span className="muted">Up next:</span>
                <span style={{ color: "var(--ink)" }}>{nd ? nd.title : n.title}</span>
                <span className="muted">· {n.duration} min</span>
              </div>
            );
          })()}
        </div>
      </div>

      <div className="live-foot">
        <button className="btn btn-ghost" style={{ flex: "0 0 auto" }} onClick={() => goTo(idx - 1)} disabled={idx === 0}><I.chevL /></button>
        <button className="btn btn-gold btn-block" style={{ flex: 1, height: 52, fontSize: 16 }} onClick={markDoneNext}>
          <I.check />{idx >= acts.length - 1 ? "Finish session" : "Mark done & next"}
        </button>
      </div>

      {mediaOpen && media && (
        <Modal title={drill.title} sub={MEDIA_META[media.type].label} onClose={() => setMediaOpen(false)}
          footer={<button className="btn btn-primary" onClick={() => setMediaOpen(false)}>Close</button>}>
          <div className="detail-media"><div className="player"><MediaThumb media={media} /></div></div>
        </Modal>
      )}
    </div>
  );
}

function LiveComplete({ session, elapsed, notes, onExit, onRestart }) {
  const noteList = Object.entries(notes).filter(([, v]) => v && v.trim());
  return (
    <div className="live theme-dark">
      <div className="live-body" style={{ justifyContent: "center" }}>
        <div className="live-stage" style={{ textAlign: "center", alignItems: "center" }}>
          <span style={{ width: 88, height: 88, borderRadius: "50%", background: "color-mix(in srgb, var(--c-physical) 22%, transparent)", color: "var(--c-physical)", display: "grid", placeItems: "center" }}>
            <I.checkCircle style={{ width: 46, height: 46 }} />
          </span>
          <h2 style={{ fontSize: 34 }}>Session complete! 🎉</h2>
          <div className="muted" style={{ fontSize: 16 }}>{session.name} · {session.activities.length} activities · {fmtClock(elapsed)} on the pitch</div>

          {noteList.length > 0 && (
            <div className="live-card" style={{ padding: "16px 18px", textAlign: "left", width: "100%" }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Your session notes</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {noteList.map(([i, v]) => {
                  const a = session.activities[i]; const d = a?.drillId ? OTJ.drillById[a.drillId] : null;
                  return (
                    <div key={i}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{d ? d.title : a?.title}</div>
                      <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>{v}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="row" style={{ gap: 10, marginTop: 8 }}>
            <button className="btn btn-ghost btn-lg" onClick={onRestart}><I.rotate />Run again</button>
            <button className="btn btn-gold btn-lg" onClick={onExit}><I.check />Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.LiveSession = LiveSession;
})();
