import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BoardStage, type BoardMode } from './Board'
import { formationPositions, type Token } from '../lib/tacticsBoard'
import type { Team } from '../lib/data'

// BoardStage is the board surface pulled out so the two modes are one testable
// unit, the same static-markup style as the rest of the suite. The pins that
// matter: view mode renders the read only board with no drag affordances and a
// single Edit board button, and edit mode renders the editable pitch (drag
// handling) with the full toolset and the Done and Cancel actions.

const tokens: Token[] = formationPositions('2-3-1', 'home')
const teams: Team[] = [
  { id: 'team-1', name: 'Titans' },
  { id: 'team-2', name: 'Trojans' },
]
const noop = () => {}

function render(mode: BoardMode, selectedId: string | null = null): string {
  return renderToStaticMarkup(
    <BoardStage
      mode={mode}
      tokens={tokens}
      selectedId={selectedId}
      onEdit={noop}
      onDone={noop}
      onCancel={noop}
      onMove={noop}
      onSelect={noop}
      onDelete={noop}
      teamList={teams}
      selectedTeam="team-1"
      onTeam={noop}
      formation="2-3-1"
      onFormation={noop}
      side="home"
      onSide={noop}
      teamPlayerCount={5}
      onSeedRoster={noop}
      onAddToken={noop}
      onClear={noop}
      name="Titans high press"
      onName={noop}
      dirty={false}
      canSave
      saving={false}
      saveError={null}
      loadedId={null}
      onSave={noop}
    />,
  )
}

describe('BoardStage view mode', () => {
  it('renders the read only board with no drag handlers', () => {
    const html = render('view')
    // The read only renderer draws static discs (spans), never the editable
    // pitch's draggable button discs or label inputs.
    expect(html).toContain('board-disc-static')
    expect(html).not.toContain('class="board-disc"')
    expect(html).not.toContain('aria-label="Drag player')
    expect(html).not.toContain('<input')
  })

  it('shows a single prominent Edit board button and hides the tools', () => {
    const html = render('view')
    expect(html).toContain('Edit board')
    // None of the editing tools are present in view mode.
    expect(html).not.toContain('Place a formation')
    expect(html).not.toContain('Add token')
    expect(html).not.toContain('Clear board')
    expect(html).not.toContain('Board name')
    expect(html).not.toContain('Done')
    expect(html).not.toContain('Cancel')
  })

  it('conveys the mode in text, not by colour alone', () => {
    expect(render('view')).toContain('Viewing')
  })
})

describe('BoardStage edit mode', () => {
  it('attaches the editable pitch: each token is a selectable button disc', () => {
    const html = render('edit')
    // The editable pitch renders each token as a button disc carrying the
    // selection state (aria-pressed), never the read only static span.
    expect(html).toContain('class="board-disc"')
    expect(html).toContain('aria-pressed=')
    expect(html).not.toContain('board-disc-static')
  })

  it('shows the full toolset', () => {
    const html = render('edit')
    expect(html).toContain('Place a formation')
    expect(html).toContain('Seed')
    expect(html).toContain('Add token')
    expect(html).toContain('Remove selected')
    expect(html).toContain('Clear board')
    expect(html).toContain('Board name')
    // The home and away colour toggle.
    expect(html).toContain('aria-label="Token colour"')
  })

  it('reflects no selection: no disc ring and the tip prompts a tap', () => {
    const html = render('edit', null)
    // No disc carries the selected ring class. (aria-pressed alone is not a
    // disc signal here: the home and away colour toggle uses it too.)
    expect(html).not.toContain('board-disc selected')
    expect(html).toContain('Tap a player to select')
  })

  it('marks the selected token and switches the tip to the selected state', () => {
    const selected = tokens[1]
    const html = render('edit', selected.id)
    // The selected disc shows the ring state on the pitch, and only one disc
    // does. The ring class is disc specific, unlike aria-pressed which the
    // colour toggle shares.
    expect(html).toContain('class="board-disc selected"')
    expect(html.split('class="board-disc selected"').length - 1).toBe(1)
    // The tip points at the delete affordances.
    expect(html).toContain('Player selected')
    expect(html).toContain('press Delete')
  })

  it('offers Done and Cancel and explains Done versus Save in text', () => {
    const html = render('edit')
    expect(html).toContain('Editing')
    expect(html).toContain('>Done</button>')
    expect(html).toContain('>Cancel</button>')
    expect(html).toContain('Save board')
    // The copy makes the relationship explicit so Done is not mistaken for Save.
    expect(html).toContain('Done returns to viewing. Save persists the board.')
  })
})
