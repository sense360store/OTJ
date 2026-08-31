// =====================================================================
// VISUAL-02, Feedback: the real page, rendered.
//
// WHAT THIS IS FOR. Feedback.test.tsx covers the four pieces that are
// presentational over an ownership or capability flag. This mounts the
// PAGE, with the data layer stubbed, because what this slice changed is
// page level: which vocabulary draws each part, and which controls each
// capability set is offered. The capability and ownership matrix is the
// half that must not move at all, so it is asserted here against the
// screen a member actually gets.
//
// WHAT IT DOES NOT DO, and why the harness exists. This project has no
// DOM, so these are static renders: an expanded row, a dialog, a write in
// flight and every focus rule are unreachable here. They are driven in a
// browser through tools/visual/feedback.mjs and measured in
// tools/visual/checks.mjs.
//
// Every name in the fixtures is invented. The feedback log holds no child
// data at all, which is asserted below rather than assumed.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FeedbackItem } from '../lib/data'

const ME = 'coach-me'

const item = (over: Partial<FeedbackItem> & Pick<FeedbackItem, 'id' | 'kind' | 'title' | 'status'>): FeedbackItem => ({
  body: 'Some detail.',
  createdBy: 'member-2',
  createdAt: '2026-08-28T09:00:00.000Z',
  updatedAt: '2026-08-28T09:00:00.000Z',
  githubIssueNumber: null,
  githubIssueUrl: null,
  ...over,
})

const ITEMS: FeedbackItem[] = [
  item({ id: 'f1', kind: 'bug', title: 'Timer drifts', status: 'new', createdBy: ME }),
  item({
    id: 'f2',
    kind: 'feature',
    title: 'A kit checklist',
    status: 'planned',
    githubIssueNumber: 128,
    githubIssueUrl: 'https://github.com/sense360store/OTJ/issues/128',
  }),
  item({ id: 'f3', kind: 'general', title: 'Away directions', status: 'in_progress' }),
  item({ id: 'f4', kind: 'feature', title: 'Bib colours', status: 'done', createdBy: ME }),
  item({ id: 'f5', kind: 'bug', title: 'Duplicate sessions', status: 'declined' }),
]

// What each read answers, so one describe can vary it without a second mock.
const reads = {
  caps: new Set<string>(),
  items: ITEMS,
  isLoading: false,
  isError: false,
}

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isSuccess: true,
  error: null,
  refetch: () => {},
  ...over,
})

const mutation = () => ({ mutate: () => {}, isPending: false, isError: false, error: null })

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: reads.caps, isPending: false }),
  useFeedback: () =>
    query(reads.isLoading || reads.isError ? undefined : reads.items, {
      isLoading: reads.isLoading,
      isError: reads.isError,
      isSuccess: !reads.isLoading && !reads.isError,
    }),
  useFeedbackComments: () => query([]),
  useFeedbackCommentCounts: () => query({ f2: 3, f3: 1 }),
  useMemberMap: () => ({
    [ME]: { id: ME, fullName: 'Sam Whitfield' },
    'member-2': { id: 'member-2', fullName: 'Priya Raghunathan' },
  }),
  useInsertFeedback: mutation,
  useUpdateFeedback: mutation,
  useDeleteFeedback: mutation,
  useSetFeedbackStatus: mutation,
  usePromoteFeedbackToGithub: mutation,
  useRefreshFeedbackFromGithub: mutation,
  useAddFeedbackComment: mutation,
  useEditFeedbackComment: mutation,
  useDeleteFeedbackComment: mutation,
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: ME }, profile: { id: ME, club_id: 'club' }, role: 'coach' }),
}))

const { Feedback } = await import('./Feedback')

function page(): string {
  return renderToStaticMarkup(<Feedback />)
}

// Restore the default reads after a describe has varied them, so the order
// tests run in cannot change what they assert.
function withReads(over: Partial<typeof reads>, run: () => void) {
  const before = { ...reads }
  Object.assign(reads, over)
  try {
    run()
  } finally {
    Object.assign(reads, before)
  }
}

const countOf = (html: string, needle: string) => html.split(needle).length - 1

/* ---- the capability boundary ---------------------------------------- */

describe('a capability set is offered exactly the controls it opens', () => {
  it('gives a club.manage holder a status select on every row and Promote on the unpromoted ones', () => {
    withReads({ caps: new Set(['club.manage']) }, () => {
      const html = page()
      expect(countOf(html, '<select')).toBe(5)
      // Four rows carry no issue, so four are offered the promotion; the
      // fifth shows the link instead.
      expect(countOf(html, 'to a GitHub issue')).toBe(4)
      expect(countOf(html, 'aria-label="GitHub issue #128"')).toBe(1)
    })
  })

  it('gives a member without club.manage a read only status and no promotion anywhere', () => {
    const html = page()
    expect(html).not.toContain('<select')
    expect(html).not.toContain('Promote')
    // The status is still shown, as a badge with its word.
    for (const label of ['New', 'Planned', 'In progress', 'Done', 'Declined']) {
      expect(html).toContain(label)
    }
  })

  it('keeps the issue link club wide, so a member without club.manage still follows what was promoted', () => {
    expect(page()).toContain('aria-label="GitHub issue #128"')
  })

  it('offers New feedback to every member, which is what the feedback RLS allows', () => {
    // 0019_feedback.sql opens the insert to the parent role, and App.tsx puts
    // the route behind no capability guard. The roadmap's older phrase "read
    // only as parent" describes neither the migration nor the screen; the
    // live behaviour is what this pins.
    expect(page()).toContain('New feedback')
    withReads({ caps: new Set(['club.manage']) }, () => expect(page()).toContain('New feedback'))
  })
})

/* ---- ownership ------------------------------------------------------- */

describe('ownership decides the edit and delete affordances, and nothing else does', () => {
  it('offers them on the two rows the member filed and on no other', () => {
    const html = page()
    expect(html).toContain('aria-label="Edit Timer drifts"')
    expect(html).toContain('aria-label="Delete Timer drifts"')
    expect(html).toContain('aria-label="Edit Bib colours"')
    expect(html).not.toContain('aria-label="Edit A kit checklist"')
    expect(html).not.toContain('aria-label="Delete A kit checklist"')
    expect(countOf(html, 'aria-label="Edit ')).toBe(2)
    expect(countOf(html, 'aria-label="Delete ')).toBe(2)
  })

  it('does not let club.manage grant them on somebody else’s item', () => {
    withReads({ caps: new Set(['club.manage']) }, () => {
      const html = page()
      expect(countOf(html, 'aria-label="Edit ')).toBe(2)
      expect(countOf(html, 'aria-label="Delete ')).toBe(2)
      expect(html).not.toContain('aria-label="Edit A kit checklist"')
    })
  })
})

/* ---- the badges ------------------------------------------------------ */

describe('the badges keep classification and state apart', () => {
  it('paints the status with the semantic tone its state means', () => {
    const html = page()
    // new is the neutral badge (no tone class at all), and the other four
    // take the tone their state means.
    expect(html).toContain('class="badge badge-info"')
    expect(html).toContain('class="badge badge-warning"')
    expect(html).toContain('class="badge badge-success"')
    expect(html).toContain('class="badge badge-danger"')
  })

  it('gives the kind no semantic tone, so a Bug is not an error and General is not a warning', () => {
    const src = readFileSync(fileURLToPath(new URL('./Feedback.tsx', import.meta.url)), 'utf8')
    // The kind renders as a bare Badge. A tone on it would be a state palette
    // standing in for a category, which is what the old KIND_COLOR did.
    expect(src).toMatch(/<Badge>\{FEEDBACK_KIND_LABELS\[item\.kind\]\}<\/Badge>/)
    expect(src).not.toContain('KIND_COLOR')
    expect(src).not.toContain('STATUS_COLOR')
    expect(src).not.toContain('TagBadge')
    // And no local colour recipe survives. The two remaining mentions are in
    // the comments that say what was retired, so the call itself is what is
    // hunted rather than the word.
    expect(src).not.toContain('color-mix(')
  })

  it('carries a dot and a word on every badge, so no state is colour alone', () => {
    const html = page()
    // A neutral badge carries `class="badge"` and a toned one
    // `class="badge badge-<tone>"`, so the two forms are counted separately;
    // a bare `class="badge` prefix would also match every dot.
    const badges = countOf(html, 'class="badge"') + countOf(html, 'class="badge badge-')
    // Ten: a kind and a status on each of the five rows, and the status
    // exactly ONCE. The first version of this screen rendered it in the meta
    // line AND in the action cluster for a member without club.manage, and
    // nothing that scoped itself to one of the two could see it.
    expect(badges).toBe(10)
    expect(countOf(html, 'class="badge-dot"')).toBe(badges)
    for (const word of ['Bug', 'Feature', 'General']) expect(html).toContain(word)
  })
})

/* ---- the page's states ----------------------------------------------- */

describe('the page renders each state family distinctly', () => {
  it('renders a skeleton rather than centred grey text while the log is loading', () => {
    withReads({ isLoading: true }, () => {
      const html = page()
      expect(html).toContain('skeleton-list')
      expect(html).toContain('Loading feedback…')
      expect(html).not.toContain('fb-item')
    })
  })

  it('renders an alert with a retry when the log fails to load', () => {
    withReads({ isError: true }, () => {
      const html = page()
      expect(html).toContain('state-error')
      expect(html).toContain('role="alert"')
      expect(html).toContain('Retry')
    })
  })

  it('renders the empty state with the action that resolves it named above', () => {
    withReads({ items: [] }, () => {
      const html = page()
      expect(html).toContain('No feedback yet')
      expect(html).not.toContain('fb-item')
    })
  })
})

/* ---- the structure the row carries ----------------------------------- */

describe('the row exposes its own structure', () => {
  it('gives the expander an aria-expanded and a panel it controls', () => {
    const html = page()
    expect(countOf(html, 'aria-expanded="false"')).toBe(5)
    expect(countOf(html, 'aria-controls=')).toBe(5)
    // The panel exists while collapsed, so aria-controls names something.
    expect(countOf(html, 'class="fb-panel"')).toBe(5)
  })

  it('names the comment count in words as well as showing the figure', () => {
    const html = page()
    expect(html).toContain('aria-label="3 comments"')
    expect(html).toContain('aria-label="1 comment"')
  })

  it('names the author and the age of every item', () => {
    const html = page()
    expect(html).toContain('Sam Whitfield')
    expect(html).toContain('Priya Raghunathan')
  })
})

/* ---- the boundaries this slice must not move ------------------------- */

describe('the frozen product boundaries', () => {
  const src = readFileSync(fileURLToPath(new URL('./Feedback.tsx', import.meta.url)), 'utf8')

  it('reads no player, roster or child identity of any kind', () => {
    // The log is about the application, not about coaching content, and it
    // has never held a child's name. A visual pass is exactly the kind of
    // change that could add one for a label.
    for (const forbidden of ['usePlayers', 'useClubPlayerIdentities', 'players.view', 'playerId', 'displayName']) {
      expect(src, forbidden).not.toContain(forbidden)
    }
  })

  it('keeps the admin GitHub refresh gated on club.manage and fired once per open', () => {
    expect(src).toMatch(/if \(!canManage \|\| refreshedRef\.current\) return/)
    expect(src).toContain('refreshedRef.current = true')
    expect(src).toContain('refreshFromGithub()')
  })

  it('posts only the title and the body to GitHub, and says so before it does', () => {
    expect(src).toMatch(/promote\.mutate\(\s*\{ id: item\.id, title, body \}/)
    expect(src).toContain('The repository is public, so this issue is world readable.')
    expect(src).toContain("Do not include any name, child's name, email,")
    expect(src).toContain('Only the title and details below are posted.')
  })

  it('keeps the public repository caution at the danger tone rather than softening it', () => {
    expect(src).toMatch(/<Note tone="danger" className="fb-promote-warning">/)
  })

  it('keeps the title minimum the check constraint enforces, in both forms', () => {
    expect(countOf(src, 'trim().length >= 3')).toBe(2)
  })

  it('keeps every dialog dismissible while its write is in flight, which is the unchanged contract', () => {
    // Every adopted Registered players dialog passes dismissible={!busy}.
    // These never have, and the brief freezes that; changing it is a
    // behaviour change rather than an adoption.
    expect(src).not.toContain('dismissible')
  })
})
