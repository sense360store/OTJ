// The one compact checkbox used across the Users screen: the capability grid
// cells and the role and team pickers all render this, so the tick cannot
// drift between them. A real checkbox stays in the DOM for focus, keyboard
// and screen reader use, visually hidden over the drawn box that carries the
// look, the standard accessible custom checkbox pattern.
import { Icon } from './icons'
import './Tick.css'

export function Tick({
  checked,
  disabled,
  title,
  ariaLabel,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  title?: string
  ariaLabel?: string
  onChange: () => void
}) {
  return (
    <span className="tick" title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={ariaLabel} onChange={onChange} />
      <span className="tick-box" aria-hidden="true">
        <Icon.check strokeWidth={3.4} />
      </span>
    </span>
  )
}
