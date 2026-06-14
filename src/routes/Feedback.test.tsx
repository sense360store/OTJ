import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommentThread, FeedbackCard, FeedbackFormModal } from './Feedback'
import type { FeedbackComment, FeedbackItem } from '../lib/data'
import type { FeedbackInput } from '../lib/queries'

// FeedbackCard and FeedbackFormModal are presentational over the capability
// and ownership flags and the mutation wiring, so the static renderer covers
// them without a DOM or a query client, the same style as the rest of the
// suite. RLS is the real enforcement; these pin what the UI surfaces to whom,
// and that the form holds the title rule the check constraint enforces.

const item: FeedbackItem = {
  id: 'f1',
  kind: 'bug',
  title: 'Timer drifts on the live screen',
  body: 'After ten minutes the clock reads two seconds fast.',
  status: 'planned',
  createdBy: 'u1',
  createdAt: '2026-06-01T10:00:00.000Z',
  updatedAt: '2026-06-01T10:00:00.000Z',
  githubIssueNumber: null,
  githubIssueUrl: null,
}

const noop = () => {}

function renderCard(flags: { isOwner?: boolean; canManage?: boolean; override?: Partial<FeedbackItem> } = {}): string {
  return renderToStaticMarkup(
    <FeedbackCard
      item={{ ...item, ...flags.override }}
      authorName="Sam Coach"
      isOwner={flags.isOwner ?? false}
      canManage={flags.canManage ?? false}
      onEdit={noop}
      onDelete={noop}
      onStatus={noop}
      onPromote={noop}
    />,
  )
}

describe('FeedbackCard', () => {
  it('shows kind, title, author and the status as a badge for a member without club.manage', () => {
    const html = renderCard()
    expect(html).toContain('Bug')
    expect(html).toContain('Timer drifts on the live screen')
    expect(html).toContain('Sam Coach')
    expect(html).toContain('Planned')
    expect(html).not.toContain('<select')
  })

  it('renders the status select only for club.manage holders, listing every status', () => {
    const html = renderCard({ canManage: true })
    expect(html).toContain('<select')
    for (const label of ['New', 'Planned', 'In progress', 'Done', 'Declined']) {
      expect(html).toContain(label)
    }
  })

  it('shows edit and delete only when the member filed the item', () => {
    const own = renderCard({ isOwner: true })
    expect(own).toContain('aria-label="Edit Timer drifts on the live screen"')
    expect(own).toContain('aria-label="Delete Timer drifts on the live screen"')
    const others = renderCard()
    expect(others).not.toContain('aria-label="Edit')
    expect(others).not.toContain('aria-label="Delete')
  })
})

describe('FeedbackCard promote to GitHub', () => {
  it('offers the promote action to a club.manage holder', () => {
    const html = renderCard({ canManage: true })
    expect(html).toContain('aria-label="Promote Timer drifts on the live screen to a GitHub issue"')
  })

  it('does not offer the promote action to a member without club.manage', () => {
    const html = renderCard()
    expect(html).not.toContain('Promote')
  })

  it('shows the issue link, not the promote action, once the item is promoted', () => {
    const html = renderCard({
      canManage: true,
      override: { githubIssueNumber: 12, githubIssueUrl: 'https://github.com/sense360store/OTJ/issues/12' },
    })
    expect(html).toContain('aria-label="GitHub issue #12"')
    expect(html).toContain('https://github.com/sense360store/OTJ/issues/12')
    expect(html).not.toContain('Promote')
  })

  it('shows the issue link to a member without club.manage too', () => {
    const html = renderCard({
      override: { githubIssueNumber: 12, githubIssueUrl: 'https://github.com/sense360store/OTJ/issues/12' },
    })
    expect(html).toContain('aria-label="GitHub issue #12"')
  })
})

describe('FeedbackCard comment count', () => {
  it('shows nothing when there are no comments', () => {
    expect(renderCard()).not.toContain('comment')
  })

  it('shows the count when there are comments', () => {
    const html = renderToStaticMarkup(
      <FeedbackCard
        item={item}
        authorName="Sam Coach"
        isOwner={false}
        canManage={false}
        commentCount={3}
        onEdit={noop}
        onDelete={noop}
        onStatus={noop}
      />,
    )
    expect(html).toContain('aria-label="3 comments"')
    expect(html).toContain('>3<')
  })
})

const comments: FeedbackComment[] = [
  {
    id: 'c1',
    feedbackId: 'f1',
    body: 'First, asking for detail.',
    createdBy: 'u1',
    createdAt: '2026-06-01T11:00:00.000Z',
    updatedAt: '2026-06-01T11:00:00.000Z',
  },
  {
    id: 'c2',
    feedbackId: 'f1',
    body: 'Second, a reply from someone else.',
    createdBy: 'u2',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
  },
]

function renderThread(flags: { currentUserId?: string; canManage?: boolean } = {}): string {
  return renderToStaticMarkup(
    <CommentThread
      comments={comments}
      authorNameFor={(id) => (id === 'u1' ? 'Sam Coach' : 'Alex Admin')}
      currentUserId={flags.currentUserId}
      canManage={flags.canManage ?? false}
      onEdit={noop}
      onDelete={noop}
    />,
  )
}

describe('CommentThread', () => {
  it('renders comments oldest first', () => {
    const html = renderThread()
    expect(html.indexOf('First, asking for detail.')).toBeLessThan(html.indexOf('Second, a reply from someone else.'))
  })

  it('shows edit and delete on a member own comment and not on another member comment', () => {
    const html = renderThread({ currentUserId: 'u1' })
    expect(html).toContain('aria-label="Edit comment by Sam Coach"')
    expect(html).toContain('aria-label="Delete comment by Sam Coach"')
    expect(html).not.toContain('aria-label="Edit comment by Alex Admin"')
    expect(html).not.toContain('aria-label="Delete comment by Alex Admin"')
  })

  it('shows delete on any comment for a club.manage holder', () => {
    const html = renderThread({ currentUserId: 'u1', canManage: true })
    expect(html).toContain('aria-label="Delete comment by Sam Coach"')
    expect(html).toContain('aria-label="Delete comment by Alex Admin"')
    // Edit stays with the author alone, never granted by club.manage.
    expect(html).not.toContain('aria-label="Edit comment by Alex Admin"')
  })
})

function renderForm(initial?: FeedbackInput): string {
  return renderToStaticMarkup(
    <FeedbackFormModal
      title="New feedback"
      sub="Visible to the whole club."
      submitLabel="Send feedback"
      busyLabel="Sending…"
      initial={initial}
      busy={false}
      error=""
      onClose={noop}
      onSubmit={noop}
    />,
  )
}

describe('FeedbackFormModal', () => {
  // With busy false, the submit button is the only element the form ever
  // disables, so the attribute's presence pins the validation directly.
  it('keeps send disabled until a title is entered', () => {
    expect(renderForm()).toContain('disabled')
  })

  it('enables send once the title passes the 3 character minimum', () => {
    expect(renderForm({ kind: 'feature', title: 'Add a kit checklist', body: '' })).not.toContain('disabled')
  })

  it('offers the three kinds and prefills an edit', () => {
    const html = renderForm({ kind: 'general', title: 'Pitch directions', body: 'A map link would help.' })
    for (const label of ['Feature', 'Bug', 'General']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('Pitch directions')
    expect(html).toContain('A map link would help.')
  })
})
