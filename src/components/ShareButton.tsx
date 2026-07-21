// The internal club link Share control as a self-contained container: a coach
// taps it on Session Day, Drill Detail or Programme Detail to copy or natively
// share the canonical protected URL of that content. The recipient signs in and
// must already have club access, so RLS stays the only boundary and the link
// makes no database write and creates no public share.
//
// The presentational body and its feedback live in ShareControlView (ui.tsx),
// and the share behaviour in useShare / src/lib/share.ts. The planner does not
// use this container because it must save first (see Planner.tsx); it composes
// the same pieces onto its guarded save seam instead.
import { useShare } from '../hooks/useShare'
import { canonicalUrl, SHARE_ACCOUNT_NOTE, type ShareKind } from '../lib/share'
import { ShareControlView } from './ui'

export function ShareButton({
  kind,
  id,
  title,
  buttonClassName,
}: {
  kind: ShareKind
  id: string
  title: string
  buttonClassName?: string
}) {
  const { share, feedback } = useShare()
  const onShare = () => {
    // Built at click time within the user gesture, so the native sheet keeps its
    // activation. The url is exactly the canonical page; the title and text
    // carry the content's own name, already visible on the club-wide readable
    // page, and nothing operational.
    share({ url: canonicalUrl(kind, id), title, text: title })
  }
  return (
    <ShareControlView
      label="Share"
      note={SHARE_ACCOUNT_NOTE}
      feedback={feedback}
      onShare={onShare}
      buttonClassName={buttonClassName}
    />
  )
}
