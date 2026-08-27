// OTJ Training Hub, the sharing level control.
//
// One control, used in two places: inside the ordinary edit form for a drill,
// week, programme, session or file, and inside the Share flow when the only
// thing stopping a public link is this item's own level. Both routes save the
// same way, and both require an explicit choice and an explicit Save. Nothing
// here changes a level as a side effect of anything else, least of all of
// pressing Share.
//
// The three levels are shown in the club's words. The enum names never reach a
// screen.
//
// England Football derived content renders locked, with the reason, because the
// database refuses to raise it (migration 0043). Offering a control the server
// will always refuse would be worse than not offering one.

import { useState } from 'react'
import type { ContentRights } from '../lib/data'
import {
  canSaveRights,
  deriveProvenanceAll,
  type RightsControlState,
  RIGHTS_NOUN,
  type RightsKind,
  rightsControlState,
  rightsStatusLine,
  type SourceFields,
} from '../lib/contentRights'
import { useUpdateContentRights } from '../lib/queries'
import { initialRightsSelection } from '../lib/shareFlow'
import { ActionError } from './ui'
import { Icon } from './icons'

// ---- Pure view ---------------------------------------------------------

export function RightsFieldView({
  noun,
  state,
  selected,
  confirmed,
  saving,
  saved,
  onSelect,
  onConfirm,
  onSave,
  idPrefix = 'rights',
}: {
  noun: string
  state: RightsControlState
  selected: ContentRights
  confirmed: boolean
  saving: boolean
  saved: boolean
  onSelect: (v: ContentRights) => void
  onConfirm: (v: boolean) => void
  onSave: () => void
  idPrefix?: string
}) {
  const canSave = canSaveRights({ selected, current: state.current, state, confirmed })
  const needsConfirm = selected !== 'internal_only' && !!state.confirm
  return (
    <fieldset className="rights-field" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="eyebrow" style={{ padding: 0 }}>
        Sharing level
      </legend>
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.5, margin: '4px 0 8px' }}>
        {rightsStatusLine(state.current, noun)}
      </p>

      {state.locked ? (
        <p className="rights-locked" role="note" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          <Icon.lock />
          {state.note}
        </p>
      ) : (
        <>
          <div className="rights-options" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {state.options.map((o) => {
              const id = `${idPrefix}-${o.value}`
              return (
                <label
                  key={o.value}
                  htmlFor={id}
                  className="rights-option"
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minHeight: 44, cursor: state.editable ? 'pointer' : 'default' }}
                >
                  <input
                    id={id}
                    type="radio"
                    name={idPrefix}
                    value={o.value}
                    checked={selected === o.value}
                    disabled={!state.editable || saving}
                    onChange={() => onSelect(o.value)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 700, display: 'block' }}>{o.label}</span>
                    <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{o.description}</span>
                  </span>
                </label>
              )
            })}
          </div>

          {state.note && (
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 8 }}>
              {state.note}
            </p>
          )}

          {needsConfirm && (
            <label
              htmlFor={`${idPrefix}-confirm`}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', minHeight: 44, marginTop: 8 }}
            >
              <input
                id={`${idPrefix}-confirm`}
                type="checkbox"
                checked={confirmed}
                disabled={!state.editable || saving}
                onChange={(e) => onConfirm(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>{state.confirm}</span>
            </label>
          )}

          {state.editable && (
            <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ minHeight: 44 }}
                disabled={!canSave || saving}
                onClick={onSave}
              >
                {saving ? 'Saving…' : 'Save sharing level'}
              </button>
              <span role="status" style={{ fontSize: 13, fontWeight: 700, color: 'var(--success)' }}>
                {saved ? 'Sharing level saved' : ''}
              </span>
            </div>
          )}
        </>
      )}
    </fieldset>
  )
}

// ---- Container ---------------------------------------------------------

export function RightsControl({
  kind,
  id,
  current,
  source,
  draftSource,
  canEdit,
  onSaved,
  onSavingChange,
  idPrefix,
}: {
  kind: RightsKind
  id: string
  current: ContentRights
  // The saved row's source columns.
  source: SourceFields
  // The unsaved source the user is typing into the same form, where there is
  // one. Read together with the saved row and the strongest wins, so pasting an
  // England Football link locks the control before the save the database would
  // refuse, and clearing that field in the draft does not unlock a row whose
  // saved source is still England Football.
  draftSource?: SourceFields
  // The caller's existing ownership decision, the same one that shows Edit.
  canEdit: boolean
  onSaved?: (rights: ContentRights) => void
  // Lets a surrounding dialog freeze its dismissal routes while this write is
  // in flight, so closing cannot drop the result of a write that still lands.
  onSavingChange?: (saving: boolean) => void
  idPrefix?: string
}) {
  const noun = RIGHTS_NOUN[kind]
  const state = rightsControlState({
    current,
    provenance: deriveProvenanceAll(draftSource ? [source, draftSource] : [source]),
    canEdit,
    isMedia: kind === 'media',
  })
  const [selected, setSelected] = useState<ContentRights>(() => initialRightsSelection(state.current))
  const [confirmed, setConfirmed] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateContentRights()

  const save = () => {
    setError(null)
    setSaved(false)
    onSavingChange?.(true)
    update.mutate(
      { kind, id, rights: selected },
      {
        onSuccess: (res) => {
          setSaved(true)
          setConfirmed(false)
          onSaved?.(res.rights)
        },
        onError: (e) => setError(e.message),
        onSettled: () => onSavingChange?.(false),
      },
    )
  }

  return (
    <div className="rights-control">
      <RightsFieldView
        noun={noun}
        state={state}
        selected={selected}
        confirmed={confirmed}
        saving={update.isPending}
        saved={saved}
        onSelect={(v) => {
          setSelected(v)
          setSaved(false)
          if (v === 'internal_only') setConfirmed(false)
        }}
        onConfirm={setConfirmed}
        onSave={save}
        idPrefix={idPrefix ?? `rights-${kind}-${id}`}
      />
      {error && <ActionError onRetry={save}>{error}</ActionError>}
    </div>
  )
}

// A read-only note for a form that is creating something new: there is no row
// to classify yet, and saying so is more honest than showing a control whose
// choice would be dropped.
export function RightsNewNote({ noun }: { noun: string }) {
  return (
    <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
      A new {noun} starts as club only. You can change its sharing level after saving it.
    </p>
  )
}
