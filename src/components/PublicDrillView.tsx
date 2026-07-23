// OTJ Training Hub, public drill renderer (Content Sharing PR 2).
//
// A pure, presentational view of a PUBLIC drill snapshot, used in two places:
//   - the coach's pre-publish preview (mode="preview"), and
//   - the anonymous public page (mode="public").
//
// It imports only React and the pure publicShare types, so the anonymous page
// can render a shared drill without pulling in the authenticated data layer
// (queries.ts, useAuth) or the app UI kit. All free text renders as React text
// nodes (never innerHTML), so nothing rich or active can execute; the server
// side builder already stripped tags and scripts, and this is the second layer.

import type { PublicDrillMedia, PublicDrillSnapshot } from '../lib/publicShare'

// Exported so the session renderer (PublicSessionView) reuses the exact same
// header pills, text blocks and list blocks as a drill, for one visual system.
export function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="public-pill">
      <span className="public-pill-label">{label}</span>
      <span className="public-pill-value">{value}</span>
    </span>
  )
}

export function TextBlock({ heading, body }: { heading: string; body: string }) {
  if (!body) return null
  return (
    <section className="public-block">
      <h2 className="public-block-head">{heading}</h2>
      {body.split('\n').map((line, i) => (
        <p key={i} className="public-para">{line}</p>
      ))}
    </section>
  )
}

export function ListBlock({ heading, items }: { heading: string; items: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <section className="public-block">
      <h2 className="public-block-head">{heading}</h2>
      <ul className="public-list">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </section>
  )
}

function MediaItem({ media, mode }: { media: PublicDrillMedia; mode: 'preview' | 'public' }) {
  const caption = media.caption ?? ''
  // Preview mode never has a signed url (no signing happens before publish);
  // it describes what a viewer will get instead.
  if (mode === 'preview') {
    let note = ''
    if (media.type === 'youtube') note = media.link ? 'A link to the video will be shown.' : 'This video cannot be shared publicly.'
    else if (media.type === 'image' || media.type === 'pdf' || media.type === 'video') note = 'This file will be shown through a temporary link.'
    return (
      <figure className="public-media public-media-preview">
        {caption && <figcaption className="public-media-caption">{caption}</figcaption>}
        <p className="muted public-media-note">{note}</p>
      </figure>
    )
  }
  // Public mode: render the signed url or the external link.
  return (
    <figure className="public-media">
      {media.type === 'image' && media.url && (
        <img className="public-media-image" src={media.url} alt={caption || 'Drill diagram'} loading="lazy" />
      )}
      {media.type === 'video' && media.url && (
        <video className="public-media-video" src={media.url} controls preload="none" aria-label={caption || 'Drill video'} />
      )}
      {media.type === 'pdf' && media.url && (
        <a className="public-media-link" href={media.url} target="_blank" rel="noopener noreferrer nofollow">
          Open PDF
        </a>
      )}
      {media.type === 'youtube' && media.link && (
        <a className="public-media-link" href={media.link} target="_blank" rel="noopener noreferrer nofollow">
          Watch the video
        </a>
      )}
      {caption && <figcaption className="public-media-caption">{caption}</figcaption>}
    </figure>
  )
}

export function PublicDrillView({
  snapshot,
  mode,
}: {
  snapshot: PublicDrillSnapshot
  mode: 'preview' | 'public'
}) {
  const Heading = mode === 'public' ? 'h1' : 'h2'
  const meta: Array<{ label: string; value: string }> = []
  if (snapshot.level) meta.push({ label: 'Level', value: snapshot.level })
  if (snapshot.ages.length > 0) meta.push({ label: 'Ages', value: snapshot.ages.join(', ') })
  if (typeof snapshot.duration === 'number') meta.push({ label: 'Duration', value: `${snapshot.duration} min` })
  if (snapshot.playerGuidance) meta.push({ label: 'Players', value: snapshot.playerGuidance })
  if (snapshot.format) meta.push({ label: 'Format', value: snapshot.format })
  if (snapshot.theme) meta.push({ label: 'Theme', value: snapshot.theme })

  const classification = snapshot.classification
  const classText = classification
    ? classification.type === 'corner'
      ? classification.value
      : classification.value.join(', ')
    : null

  return (
    <article className="public-drill">
      <header className="public-drill-head">
        {classText && <p className="public-eyebrow">{classText}</p>}
        <Heading className="public-title">{snapshot.title}</Heading>
        {snapshot.skill && <p className="public-skill">{snapshot.skill}</p>}
      </header>

      {meta.length > 0 && (
        <div className="public-meta" aria-label="Drill details">
          {meta.map((m) => <MetaPill key={m.label} label={m.label} value={m.value} />)}
        </div>
      )}

      <TextBlock heading="Summary" body={snapshot.summary ?? ''} />
      <TextBlock heading="Setup" body={snapshot.setupNotes ?? ''} />
      <TextBlock heading="Area" body={snapshot.area ?? ''} />
      <ListBlock heading="Equipment" items={snapshot.equipment} />
      <ListBlock heading="Coaching points" items={snapshot.coachingPoints} />
      <ListBlock heading="Make it easier" items={snapshot.easier} />
      <ListBlock heading="Make it harder" items={snapshot.harder} />

      {snapshot.media.length > 0 && (
        <section className="public-block">
          <h2 className="public-block-head">Media</h2>
          {snapshot.media.map((m) => <MediaItem key={m.ref} media={m} mode={mode} />)}
        </section>
      )}

      {snapshot.sourceAttribution && (
        <section className="public-block public-attribution">
          <span className="muted">Source: </span>
          <a href={snapshot.sourceAttribution.url} target="_blank" rel="noopener noreferrer nofollow">
            {snapshot.sourceAttribution.label ?? snapshot.sourceAttribution.url}
          </a>
        </section>
      )}
    </article>
  )
}
