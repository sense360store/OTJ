// OTJ Training Hub, share flow state (pure).
//
// One Share action on a drill, session or programme opens one modal that holds
// both ways of sharing: the internal club link, which needs an account, and the
// public link, which needs none. Everything the modal decides is decided here,
// away from React, so the state transitions are unit testable in a repository
// that has no DOM test facility.
//
// The modal is a single dialog with steps rather than a dialog that opens
// further dialogs: nesting dialogs breaks focus return and the Escape contract,
// and the previous design opened one from inside a permanent page section.

import type { ContentRights } from './data'

export type ShareStep = 'home' | 'preview' | 'result' | 'manage' | 'confirmRevoke' | 'classify'

// What the public part of the modal offers.
//   hidden     the user may neither publish nor revoke; the section is absent
//   disabled   the club kill switch is off
//   loading    the status read has not answered yet
//   failed     the status read failed; nothing is asserted about the link
//   create     no link exists and the user may create one
//   locked     no link exists and the user may not create one (a manager who
//              can only turn links off)
//   owned      a link exists, the user owns it and may manage it
//   others     a link exists, someone else owns it, the user may turn it off
//   readonly   a link exists and the user may only see that it does
export type PublicSectionKind =
  | 'hidden'
  | 'disabled'
  | 'loading'
  | 'failed'
  | 'create'
  | 'locked'
  | 'owned'
  | 'others'
  | 'readonly'

export interface PublicSectionInput {
  sharingEnabled: boolean
  statusPending: boolean
  statusFailed: boolean
  hasShare: boolean
  isOwner: boolean
  canPublish: boolean
  canRevokeAny: boolean
}

// The one place that decides what the public section shows. Permission is read
// before club state so a user with no authority never learns whether their club
// has public sharing switched on.
export function publicSectionState(input: PublicSectionInput): PublicSectionKind {
  const { canPublish, canRevokeAny } = input
  if (!canPublish && !canRevokeAny) return 'hidden'
  if (input.statusPending) return 'loading'
  if (input.statusFailed) return 'failed'
  if (!input.sharingEnabled) return 'disabled'
  if (input.hasShare) {
    if (input.isOwner && canPublish) return 'owned'
    if (canRevokeAny) return 'others'
    return 'readonly'
  }
  return canPublish ? 'create' : 'locked'
}

// What the preview step renders. The long privacy warning is the coach's
// prompt to check what they wrote before it goes out; showing it under a
// blocked, empty frame told them to check text that was never going anywhere,
// so it appears only when there is a real projection to check.
export interface PreviewGate {
  showBlocked: boolean
  showSnapshot: boolean
  showRightsWarning: boolean
  showConfirmNote: boolean
  canCreate: boolean
}

export function previewGate({
  eligible,
  hasValidSnapshot,
}: {
  eligible: boolean
  hasValidSnapshot: boolean
}): PreviewGate {
  const good = eligible && hasValidSnapshot
  return {
    showBlocked: !eligible,
    showSnapshot: good,
    showRightsWarning: good,
    showConfirmNote: good,
    // An eligible answer whose projection fails the client's own validator is
    // not something to publish blind. The server would still build its own
    // snapshot, but the coach was promised they would see exactly what becomes
    // public first, so a projection we cannot render is a refusal, not a
    // formality to skip.
    canCreate: good,
  }
}

// The classify step is only reachable when changing this row's own level is
// what unblocks the share, and the user has the authority to change it.
export function canOfferClassify({
  blockerAction,
  canClassify,
}: {
  blockerAction: 'classify' | 'content' | 'none'
  canClassify: boolean
}): boolean {
  return blockerAction === 'classify' && canClassify
}

// After a successful classification the preview must be taken again: the level
// that blocked it has changed, and the old answer is stale. Returning the step
// to take next keeps that decision in one tested place rather than in a
// callback.
export function stepAfterClassify(): ShareStep {
  return 'preview'
}

// Whether a create may be attempted. Guards the race where a rights change and
// a create are in flight together: create is only ever reached from a preview
// answer that is still current.
export function canAttemptCreate({
  gate,
  previewStale,
  writing,
}: {
  gate: PreviewGate
  previewStale: boolean
  writing: boolean
}): boolean {
  return gate.canCreate && !previewStale && !writing
}

// The rights level a classify step starts on. An unclassified row starts on its
// stored level, never on a public one, so nothing is promoted by simply opening
// the step.
export function initialRightsSelection(current: ContentRights): ContentRights {
  return current
}
