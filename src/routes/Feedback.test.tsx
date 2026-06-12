import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FeedbackCard, FeedbackFormModal } from './Feedback'
import type { FeedbackItem } from '../lib/data'
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
}

const noop = () => {}

function renderCard(flags: { isOwner?: boolean; canManage?: boolean } = {}): string {
  return renderToStaticMarkup(
    <FeedbackCard
      item={item}
      authorName="Sam Coach"
      isOwner={flags.isOwner ?? false}
      canManage={flags.canManage ?? false}
      onEdit={noop}
      onDelete={noop}
      onStatus={noop}
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
