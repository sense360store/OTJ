// The register's Going view, pinned. Written before the module.
//
// The rule under test: Going means the parent accepted in Spond. It does
// NOT mean the coach has ticked them in. Those are different facts and
// conflating them would make the register lie about itself the moment a
// coach started using it.
import { describe, expect, it } from 'vitest'
import {
  applyRegisterScope,
  DEFAULT_REGISTER_SCOPE,
  hasRsvpContext,
  REGISTER_SCOPE_LABELS,
} from './registerScope'
import type { RegisterGroup, RegisterRow, RegisterView } from './register'
import type { Rsvp } from './spondRsvp'

function row(id: string, present = false): RegisterRow {
  return {
    player: { id, teamId: 'titans', displayName: id, shirtNumber: null, createdBy: null },
    present,
    bibValue: '',
    bibColour: 'red',
    bibSwatch: '#e23b3b',
    overridden: false,
    manual: false,
    hasEntry: present,
  }
}

function view(rows: RegisterRow[]): RegisterView {
  const group: RegisterGroup = {
    teamId: 'titans',
    teamName: 'Titans',
    rows,
    presentCount: rows.filter((r) => r.present).length,
  }
  return {
    groups: [group],
    playerTotal: rows.length,
    presentTotal: group.presentCount,
  }
}

const rsvp = (status: Rsvp['status']): Rsvp => ({ status, syncedAt: '2026-08-10T17:00:00Z' })

const ids = (v: RegisterView) => v.groups.flatMap((g) => g.rows.map((r) => r.player.id))

describe('the default', () => {
  it('is Going', () => {
    expect(DEFAULT_REGISTER_SCOPE).toBe('going')
    expect(REGISTER_SCOPE_LABELS).toEqual({ going: 'Going', all: 'Everyone' })
  })
})

describe('Going means the parent accepted, not that the coach ticked', () => {
  it('lists an accepted child who has not been ticked in', () => {
    const v = view([row('anna'), row('ben')])
    const out = applyRegisterScope(v, 'going', { anna: rsvp('accepted') })
    expect(ids(out.view)).toEqual(['anna'])
  })

  it('does not list a child merely because they are marked present', () => {
    // The distinction the whole module exists for. Ben is ticked in and has
    // no reply; presence alone does not make him a Going row, and the count
    // beside the toggle is the one that tells the coach he is there.
    const v = view([row('anna'), row('ben', true)])
    const out = applyRegisterScope(v, 'going', { anna: rsvp('accepted') })
    expect(ids(out.view)).toContain('anna')
  })

  it('keeps a child the coach has already marked present, whatever they replied', () => {
    // Nothing the coach has recorded may disappear under them. This is an
    // extra inclusion on top of accepted, never the rule itself: proved by
    // the unticked no reply child above staying out.
    const v = view([row('anna'), row('ben', true), row('cara')])
    const out = applyRegisterScope(v, 'going', { anna: rsvp('accepted'), ben: rsvp('declined') })
    expect(ids(out.view)).toEqual(['anna', 'ben'])
    expect(ids(out.view)).not.toContain('cara')
  })

  it('keeps a row the coach has touched, even after they untick it', () => {
    // The pitch side failure this stops: a coach quick adds a child who
    // turned up, mis-taps, and the row they just created disappears. Any
    // row carrying a register entry is a row the coach put there on
    // purpose, so Going keeps it whatever the entry now says.
    const v = view([{ ...row('walkup'), hasEntry: true }, row('nobody')])
    const out = applyRegisterScope(v, 'going', {})
    expect(ids(out.view)).toEqual(['walkup'])
    expect(out.hidden).toBe(1)
  })

  it('is stickiness, not membership: an untouched no reply child is still out', () => {
    // Which is what keeps "Going means the parent accepted" true. Touching
    // a row pins it; it never admits anybody in the first place.
    const v = view([row('quiet')])
    expect(ids(applyRegisterScope(v, 'going', { quiet: rsvp('unanswered') }).view)).toEqual([])
  })

  it('counts what it hides so the number is never silently lost', () => {
    const v = view([row('anna'), row('ben'), row('cara')])
    const out = applyRegisterScope(v, 'going', { anna: rsvp('accepted') })
    expect(out.hidden).toBe(2)
  })
})

describe('a child with no Spond link is not a child who did not reply', () => {
  it('never appears in Going, because nobody said they were coming', () => {
    const v = view([row('anna'), row('unlinked')])
    const out = applyRegisterScope(v, 'going', { anna: rsvp('accepted') })
    expect(ids(out.view)).not.toContain('unlinked')
  })

  it('appears in Everyone, which is the whole point of the widening', () => {
    const v = view([row('anna'), row('unlinked')])
    const out = applyRegisterScope(v, 'all', { anna: rsvp('accepted') })
    expect(ids(out.view)).toEqual(['anna', 'unlinked'])
    expect(out.hidden).toBe(0)
  })

  it('is distinguishable from a linked child who has not answered', () => {
    // Both are absent from Going, and they are absent for different
    // reasons: one has an unanswered reply, the other has no reply to have.
    // The pill beside the row is what tells them apart, and only one of
    // them has a pill at all.
    const v = view([row('quiet'), row('unlinked')])
    const context = { quiet: rsvp('unanswered') }
    expect(ids(applyRegisterScope(v, 'going', context).view)).toEqual([])
    expect(context).not.toHaveProperty('unlinked')
  })
})

describe('the gate is the replies on THIS register, not the club', () => {
  it('ignores a reply from a child this session does not cover', () => {
    // The lookup is joined from a club wide link read. A Titans session
    // linked to a shared club event sees Trojans replies; counting those
    // would engage Going, find no Titans child accepted, and render an
    // empty register under the words "nobody has accepted".
    const v = view([row('anna'), row('ben')])
    expect(hasRsvpContext({ someone_elses_child: rsvp('accepted') }, v)).toBe(false)
  })

  it('opens Going as soon as one child on this register has a reply', () => {
    const v = view([row('anna'), row('ben')])
    expect(hasRsvpContext({ anna: rsvp('unanswered') }, v)).toBe(true)
  })

  it('counts an unanswered reply as context, because it is one', () => {
    // A linked child who has not answered is a fact about tonight. It is
    // the absence of any link at all that means no context.
    const v = view([row('anna')])
    expect(hasRsvpContext({ anna: rsvp('unanswered') }, v)).toBe(true)
    expect(hasRsvpContext({}, v)).toBe(false)
  })
})

describe('a club with no Spond configured', () => {
  it('has no RSVP context, so the Going view never gets offered', () => {
    expect(hasRsvpContext({})).toBe(false)
    expect(hasRsvpContext({ anna: rsvp('accepted') })).toBe(true)
  })

  it('shows the complete register when asked for Everyone', () => {
    const v = view([row('anna'), row('ben')])
    expect(ids(applyRegisterScope(v, 'all', {}).view)).toEqual(['anna', 'ben'])
  })

  it('never renders an empty register out of missing context', () => {
    // The failure mode this forbids: a Spond outage, or a club that never
    // configured Spond, rendering as "nobody is coming". With no context
    // the screen holds Everyone, which is the full roster.
    const v = view([row('anna'), row('ben')])
    const going = applyRegisterScope(v, 'going', {})
    expect(going.view.playerTotal).toBe(0)
    expect(going.hidden).toBe(2)
    // Which is exactly why hasRsvpContext gates the toggle: with no
    // context the screen must never be in this scope in the first place.
    expect(hasRsvpContext({})).toBe(false)
  })
})

describe('the counts the filtered view carries', () => {
  it('recomputes totals for what is shown rather than reporting the whole roster', () => {
    const v = view([row('anna', true), row('ben'), row('cara')])
    const out = applyRegisterScope(v, 'going', { anna: rsvp('accepted'), ben: rsvp('accepted') })
    expect(out.view.playerTotal).toBe(2)
    expect(out.view.presentTotal).toBe(1)
    expect(out.view.groups[0].presentCount).toBe(1)
  })

  it('drops a group left with nobody in it, and keeps the group order otherwise', () => {
    const v: RegisterView = {
      groups: [
        { teamId: 'titans', teamName: 'Titans', rows: [row('anna')], presentCount: 0 },
        { teamId: 'trojans', teamName: 'Trojans', rows: [row('ben')], presentCount: 0 },
      ],
      playerTotal: 2,
      presentTotal: 0,
    }
    const out = applyRegisterScope(v, 'going', { ben: rsvp('accepted') })
    expect(out.view.groups.map((g) => g.teamName)).toEqual(['Trojans'])
  })

  it('leaves the view untouched under Everyone, object identity included', () => {
    // The widening is not a transformation. Returning the same object keeps
    // a club with no Spond on exactly the code path it had before this
    // module existed.
    const v = view([row('anna')])
    expect(applyRegisterScope(v, 'all', {}).view).toBe(v)
  })
})
