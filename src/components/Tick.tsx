// The one compact checkbox used across the Users screen: the capability grid
// cells and the role and team pickers all render this, so the tick cannot
// drift between them. A real checkbox stays in the DOM for focus, keyboard
// and screen reader use, visually hidden over the drawn box that carries the
// look, the standard accessible custom checkbox pattern.
//
// It is drawn rather than native because it is the one checkbox in the
// product that has to flip with the theme: the Users screen renders dozens of
// them at once and .theme-dark sets no color-scheme, so a native box would be
// white on the dark card. What it does NOT carry is its own hit area: the
// 44px target belongs to the label around it, which is .check-row where there
// is text beside the box and .check-cell in the grid, where there is not.
import { Icon } from './icons'
import './Tick.css'

export function Tick({
  checked,
  disabled,
  ariaLabel,
  describedBy,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  ariaLabel?: string
  /* The id of the sentence that accounts for this tick being held on and
     inert, so the reason is bound to the control rather than merely sitting
     near it. */
  describedBy?: string
  onChange: () => void
}) {
  return (
    <span className="tick">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        onChange={onChange}
      />
      <span className="tick-box" aria-hidden="true">
        <Icon.check strokeWidth={3.4} />
      </span>
    </span>
  )
}
