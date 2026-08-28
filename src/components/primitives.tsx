// The shared visual primitives introduced by VISUAL-01: one Button, one
// input Field, one Card, one Note, one Badge, one Toggle, one PageHeader and
// one Sheet. Each of them carries a rule that screens had previously
// discovered and encoded locally, so the local override can be deleted.
//
// This module pairs the components with the small constants they share, so
// the fast refresh component-only rule is relaxed here.
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useId, useRef } from 'react'
import type {
  ButtonHTMLAttributes,
  FocusEvent as ReactFocusEvent,
  HTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { Icon } from './icons'
import type { IconComponent } from './icons'
import { focusableElements, trapTabIndex } from '../lib/modalFocus'

/* ---- Button ------------------------------------------------------
   Six variants and three sizes, replacing the hand written class strings.
   `primary` is navy, `gold` is the one accent action, `ghost` and `quiet`
   are the secondary pair, `danger` is destructive and `on-dark` is for the
   two surfaces whose dark ground does not come from the theme (the Home
   hero and the diagram viewer chrome).

   The md size is 44px, which is the minimum hit area, so it needs no help;
   sm stays visually 36px and takes its hit area from a pseudo-element, so a
   dense desktop toolbar is unchanged while a thumb still lands on it. */
export type ButtonVariant = 'primary' | 'gold' | 'ghost' | 'quiet' | 'danger' | 'on-dark'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  gold: 'btn-gold',
  ghost: 'btn-ghost',
  quiet: 'btn-quiet',
  danger: 'btn-danger',
  'on-dark': 'btn-on-dark',
}

const SIZE_CLASS: Record<ButtonSize, string> = { sm: 'btn-sm', md: '', lg: 'btn-lg' }

export function buttonClass(
  variant: ButtonVariant = 'ghost',
  size: ButtonSize = 'md',
  extra?: { block?: boolean; className?: string },
): string {
  return [
    'btn',
    VARIANT_CLASS[variant],
    SIZE_CLASS[size],
    extra?.block ? 'btn-block' : '',
    extra?.className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  icon?: IconComponent
  className?: string
  /* Named for the same reason IconButton names it: ButtonHTMLAttributes
     carries no ref, and a caller that has to return focus to this control
     needs a handle on it. The first caller is the Registered players header's
     More actions trigger, which focuses itself again when the popup closes. */
  ref?: Ref<HTMLButtonElement>
}

export function Button({ variant = 'ghost', size = 'md', block, icon: Ico, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, { block, className })} {...rest}>
      {Ico && <Ico />}
      {children}
    </button>
  )
}

/* An icon only button: square, width equal to height, and `label` is
   required because an icon has no text to be named by. It renders the
   existing .icon-btn class rather than a second square button, so there is
   one implementation; `title` is deliberately not used, since a tooltip
   does not survive touch. */
export type IconButtonTone = 'default' | 'danger' | 'on-dark'

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
  label: string
  icon: IconComponent
  tone?: IconButtonTone
  /* A 44px visible box, for a control that sits in a row of md buttons. */
  large?: boolean
  className?: string
  /* A caller that has to return focus to this control needs a handle on it.
     ButtonHTMLAttributes carries no ref, so it is named rather than arriving
     through the spread; React 19 passes it as an ordinary prop. The first
     caller is the Registered players row menu, which focuses its trigger
     again when the popup closes. */
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({ label, icon: Ico, tone = 'default', large, className, type = 'button', ...rest }: IconButtonProps) {
  const cls = ['icon-btn', tone === 'default' ? '' : tone, large ? 'lg' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <button type={type} aria-label={label} className={cls} {...rest}>
      <Ico />
    </button>
  )
}

/* ---- Card --------------------------------------------------------
   A card contains; it never decorates. A border separates and a shadow
   elevates, and the two are not used for the same reason: `raised` is for
   something that sits above the page, not for every panel. */
export function Card({
  padded = true,
  raised,
  tinted,
  interactive,
  className,
  children,
  ...rest
}: {
  padded?: boolean
  raised?: boolean
  tinted?: boolean
  interactive?: boolean
  className?: string
  children?: ReactNode
} & HTMLAttributes<HTMLDivElement>) {
  const cls = [
    'card',
    padded ? 'card-padded' : '',
    raised ? 'card-raised' : '',
    tinted ? 'card-tinted' : '',
    interactive ? 'card-interactive' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  )
}

/* ---- Note --------------------------------------------------------
   One notice, four tones, replacing the note, banner, warning and hint
   classes that each invented their own ground. `neutral` deliberately has
   no semantic token family: a notice carrying no state is --line-2 on
   --line, which is what the archived season banner already looks like. */
export type NoteTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

const NOTE_ICON: Record<NoteTone, IconComponent> = {
  info: Icon.info,
  success: Icon.checkCircle,
  warning: Icon.alert,
  danger: Icon.danger,
  neutral: Icon.note,
}

export function Note({
  tone = 'neutral',
  icon: Ico,
  role,
  className,
  children,
}: {
  tone?: NoteTone
  icon?: IconComponent
  role?: 'alert' | 'status'
  className?: string
  children: ReactNode
}) {
  const I = Ico ?? NOTE_ICON[tone]
  return (
    <div className={['note', `note-${tone}`, className ?? ''].filter(Boolean).join(' ')} role={role}>
      <I aria-hidden="true" />
      <div className="note-body">{children}</div>
    </div>
  )
}

/* ---- Badge -------------------------------------------------------
   Read only status: a tone, a dot and a word. Never one of the three on its
   own, so status is never carried by colour alone. */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={tone === 'neutral' ? 'badge' : `badge badge-${tone}`}>
      <span className="badge-dot" aria-hidden="true"></span>
      {children}
    </span>
  )
}

/* ---- Field -------------------------------------------------------
   The label is a real <label> bound to the control, and an error sets the
   border AND renders a message AND wires aria-invalid / aria-describedby.
   A red border alone is never an error state. */
type FieldShared = { label: ReactNode; hint?: ReactNode; error?: ReactNode; id?: string; className?: string }

function useFieldIds(id: string | undefined, hint: ReactNode, error: ReactNode) {
  const auto = useId()
  const controlId = id ?? auto
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`
  const describedBy = [error ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined
  return { controlId, hintId, errorId, describedBy }
}

function FieldShell({
  controlId,
  label,
  hint,
  hintId,
  error,
  errorId,
  className,
  children,
}: {
  controlId: string
  label: ReactNode
  hint?: ReactNode
  hintId: string
  error?: ReactNode
  errorId: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={['field', className ?? ''].filter(Boolean).join(' ')}>
      <label htmlFor={controlId}>{label}</label>
      {children}
      {hint && (
        <span id={hintId} className="muted" style={{ display: 'block', marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="field-error">
          {error}
        </span>
      )}
    </div>
  )
}

export function TextField({ label, hint, error, id, className, ...rest }: FieldShared & InputHTMLAttributes<HTMLInputElement>) {
  const { controlId, hintId, errorId, describedBy } = useFieldIds(id, hint, error)
  return (
    <FieldShell {...{ controlId, label, hint, hintId, error, errorId, className }}>
      <input id={controlId} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
    </FieldShell>
  )
}

export function SelectField({
  label,
  hint,
  error,
  id,
  className,
  children,
  ...rest
}: FieldShared & SelectHTMLAttributes<HTMLSelectElement>) {
  const { controlId, hintId, errorId, describedBy } = useFieldIds(id, hint, error)
  return (
    <FieldShell {...{ controlId, label, hint, hintId, error, errorId, className }}>
      <select id={controlId} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}>
        {children}
      </select>
    </FieldShell>
  )
}

/* A textarea is multiline: 44px is its floor, not its height. Its size comes
   from `rows`, and it stays resizable vertically. */
export function TextAreaField({
  label,
  hint,
  error,
  id,
  className,
  rows = 3,
  ...rest
}: FieldShared & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { controlId, hintId, errorId, describedBy } = useFieldIds(id, hint, error)
  return (
    <FieldShell {...{ controlId, label, hint, hintId, error, errorId, className }}>
      <textarea id={controlId} rows={rows} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
    </FieldShell>
  )
}

/* ---- Toggle ------------------------------------------------------
   A real switch with a visible label and its state exposed, replacing the
   unlabelled icon button that changed colour. */
export function Toggle({
  checked,
  onChange,
  label,
  hideLabel,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hideLabel?: boolean
  id?: string
}) {
  const auto = useId()
  const controlId = id ?? auto
  return (
    <span className="toggle-row">
      <button
        type="button"
        id={controlId}
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        className={'toggle' + (checked ? ' on' : '')}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-knob" aria-hidden="true"></span>
      </button>
      {!hideLabel && (
        <label htmlFor={controlId} className="toggle-label">
          {label}
        </label>
      )}
    </span>
  )
}

/* ---- PageHeader --------------------------------------------------
   Eyebrow, title, subtitle and one action slot. The title is the page's
   <h1>: the club name in the sidebar is a label, not the heading of the
   page a coach is reading. At most one primary action; everything else is
   ghost, quiet, or in an overflow menu. */
export function PageHeader({
  eyebrow,
  title,
  sub,
  actions,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={['page-head', className ?? ''].filter(Boolean).join(' ')}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {actions && <div className="page-head-acts">{actions}</div>}
    </div>
  )
}

/* ---- Sheet -------------------------------------------------------
   The bottom sheet, sharing Modal's focus contract exactly: focus moves in
   on open, Tab is trapped, Escape closes and focus is restored to the
   opener. It differs from Modal only in placement, radius and entry.

   A menu is not a dialog: a caller that is a menu passes role="menu" and
   trapFocus={false}, and then keeps Escape and focus return without the Tab
   trap. The More sheet is a list of destinations rather than a form, so it
   is the menu case. */
export function Sheet({
  title,
  onClose,
  children,
  role = 'dialog',
  trapFocus = true,
  label,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  role?: 'dialog' | 'menu'
  trapFocus?: boolean
  label?: string
}) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const openerRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null,
  )

  // Restore focus to the opener on close, if it is still in the document.
  useEffect(() => {
    const opener = openerRef.current
    return () => {
      if (opener && typeof document !== 'undefined' && document.contains(opener)) opener.focus()
    }
  }, [])

  // Move focus inside on open, so Escape and the trap below are live.
  useEffect(() => {
    const el = sheetRef.current
    if (el && !el.contains(document.activeElement)) el.focus()
  }, [])

  const onBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (!trapFocus) return
    const el = sheetRef.current
    if (!el) return
    const next = e.relatedTarget as Node | null
    if (next && el.contains(next)) return
    queueMicrotask(() => {
      const s = sheetRef.current
      if (s && s.isConnected && !s.contains(document.activeElement)) s.focus()
    })
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (!trapFocus || e.key !== 'Tab') return
    const els = focusableElements(sheetRef.current)
    if (els.length === 0) {
      e.preventDefault()
      return
    }
    const target = trapTabIndex(els.indexOf(document.activeElement as HTMLElement), els.length, e.shiftKey)
    if (target !== null) {
      e.preventDefault()
      els[target].focus()
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className="more-sheet"
        role={role}
        aria-modal={role === 'dialog' ? true : undefined}
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        ref={sheetRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        <div className="more-sheet-head">
          <h3 id={titleId}>{title}</h3>
          <IconButton label="Close" icon={Icon.x} onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  )
}
