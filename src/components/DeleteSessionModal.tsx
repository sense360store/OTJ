// Plain confirm before a session delete, shared by the sessions list, the
// planner and the session day view. Owner or admin only; the sessions delete
// RLS is the real enforcement and the screens gate the affordance the same
// way. onDeleted lets the editor screens navigate back to the list, where
// the session's card is gone.
import { useDeleteSession } from '../lib/queries'
import type { Session } from '../lib/data'
import { Icon } from './icons'
import { Modal } from './ui'

export function DeleteSessionModal({
  s,
  onClose,
  onDeleted,
}: {
  s: Session
  onClose: () => void
  onDeleted?: () => void
}) {
  const del = useDeleteSession()
  const remove = () => del.mutate({ id: s.id }, { onSuccess: onDeleted ?? onClose })
  return (
    <Modal
      title="Delete session"
      sub={s.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" style={{ background: 'var(--m-pdf)' }} onClick={remove} disabled={del.isPending}>
            <Icon.trash />
            {del.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        This removes the session and its plan from the club calendar. The drills themselves stay in the library.
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not delete. Try again.
        </p>
      )}
    </Modal>
  )
}
