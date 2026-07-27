import { describe, expect, it } from 'vitest'
import {
  canAttemptCreate,
  canOfferClassify,
  initialRightsSelection,
  previewGate,
  type PublicSectionInput,
  publicSectionState,
  stepAfterClassify,
} from './shareFlow'

function input(over: Partial<PublicSectionInput> = {}): PublicSectionInput {
  return {
    sharingEnabled: true,
    statusPending: false,
    statusFailed: false,
    hasShare: false,
    isOwner: false,
    canPublish: true,
    canRevokeAny: false,
    ...over,
  }
}

describe('publicSectionState', () => {
  it('hides the section entirely from someone with no publishing authority', () => {
    expect(publicSectionState(input({ canPublish: false, canRevokeAny: false }))).toBe('hidden')
  })

  it('hides it before it reveals anything about the club, even while loading', () => {
    // A parent must not learn whether the club has public sharing switched on.
    expect(publicSectionState(input({ canPublish: false, canRevokeAny: false, statusPending: true }))).toBe('hidden')
    expect(publicSectionState(input({ canPublish: false, canRevokeAny: false, sharingEnabled: false }))).toBe('hidden')
  })

  it('reports the club kill switch to someone who could otherwise publish', () => {
    expect(publicSectionState(input({ sharingEnabled: false }))).toBe('disabled')
  })

  it('waits for the status read', () => {
    expect(publicSectionState(input({ statusPending: true }))).toBe('loading')
    expect(publicSectionState(input({ statusFailed: true }))).toBe('failed')
  })

  it('offers a create only to someone who may publish', () => {
    expect(publicSectionState(input({ canPublish: true }))).toBe('create')
    expect(publicSectionState(input({ canPublish: false, canRevokeAny: true }))).toBe('locked')
  })

  it('gives the owner management and a manager only a turn off', () => {
    expect(publicSectionState(input({ hasShare: true, isOwner: true, canPublish: true }))).toBe('owned')
    expect(publicSectionState(input({ hasShare: true, isOwner: false, canPublish: false, canRevokeAny: true }))).toBe('others')
  })

  it('never gives a manager rotate or refresh on another coach’s link', () => {
    // 'others' is the state the view renders as a single Turn off control; the
    // owner-only 'owned' state is the one that offers replace and refresh.
    const managerOnOther = publicSectionState(
      input({ hasShare: true, isOwner: false, canPublish: true, canRevokeAny: true }),
    )
    expect(managerOnOther).toBe('others')
  })

  it('shows a live link read only when there is nothing the viewer may do', () => {
    expect(publicSectionState(input({ hasShare: true, isOwner: false, canPublish: true, canRevokeAny: false }))).toBe('readonly')
  })
})

describe('previewGate', () => {
  it('shows the projection and the privacy warning only together', () => {
    const good = previewGate({ eligible: true, hasValidSnapshot: true })
    expect(good).toEqual({
      showBlocked: false,
      showSnapshot: true,
      showRightsWarning: true,
      showConfirmNote: true,
      canCreate: true,
    })
  })

  // The regression this change exists for: a blocked, empty preview used to
  // carry "You wrote this, it will be public" under nothing at all.
  it('shows no privacy warning and no empty frame when the share is blocked', () => {
    const blocked = previewGate({ eligible: false, hasValidSnapshot: false })
    expect(blocked.showRightsWarning).toBe(false)
    expect(blocked.showSnapshot).toBe(false)
    expect(blocked.showConfirmNote).toBe(false)
    expect(blocked.showBlocked).toBe(true)
    expect(blocked.canCreate).toBe(false)
  })

  it('refuses to create from an eligible answer whose projection will not render', () => {
    const odd = previewGate({ eligible: true, hasValidSnapshot: false })
    expect(odd.canCreate).toBe(false)
    expect(odd.showSnapshot).toBe(false)
    expect(odd.showRightsWarning).toBe(false)
  })
})

describe('the classify step', () => {
  it('is offered only when this item’s own level is the blocker and the user may change it', () => {
    expect(canOfferClassify({ blockerAction: 'classify', canClassify: true })).toBe(true)
    expect(canOfferClassify({ blockerAction: 'classify', canClassify: false })).toBe(false)
    expect(canOfferClassify({ blockerAction: 'content', canClassify: true })).toBe(false)
    expect(canOfferClassify({ blockerAction: 'none', canClassify: true })).toBe(false)
  })

  it('returns to the preview afterwards, so nothing is created on a stale answer', () => {
    expect(stepAfterClassify()).toBe('preview')
  })

  it('starts on the stored level, so opening it promotes nothing', () => {
    expect(initialRightsSelection('internal_only')).toBe('internal_only')
    expect(initialRightsSelection('public_link_only')).toBe('public_link_only')
  })
})

describe('canAttemptCreate', () => {
  const gate = previewGate({ eligible: true, hasValidSnapshot: true })

  it('allows a create from a current, eligible preview', () => {
    expect(canAttemptCreate({ gate, previewStale: false, writing: false })).toBe(true)
  })

  it('refuses while a rights change has made the preview stale', () => {
    expect(canAttemptCreate({ gate, previewStale: true, writing: false })).toBe(false)
  })

  it('refuses a second attempt while one is in flight', () => {
    expect(canAttemptCreate({ gate, previewStale: false, writing: true })).toBe(false)
  })

  it('refuses without a preview at all', () => {
    const blocked = previewGate({ eligible: false, hasValidSnapshot: false })
    expect(canAttemptCreate({ gate: blocked, previewStale: false, writing: false })).toBe(false)
  })
})
