// Confirm before deleting a drill. Shared by the drill library and the drill
// detail screen. The confirmation names the drill and states the knock on
// effect: templates reference a drill by id inside their activities with no
// database constraint, so deleting one leaves those templates with a missing
// activity. The count is read from the loaded templates and stated plainly so
// a coach knows what the delete touches before it happens.
import { useDeleteDrill, useTemplates } from '../lib/queries'
import type { Drill } from '../lib/data'
import { Icon } from './icons'
import { Modal } from './ui'

export function DeleteDrillModal({
  drill,
  onClose,
  afterDelete,
}: {
  drill: Drill
  onClose: () => void
  // Called after a successful delete, before the modal closes. The detail
  // screen uses it to leave the now removed drill; the library list needs
  // nothing, the invalidated query drops the card on its own.
  afterDelete?: () => void
}) {
  const del = useDeleteDrill()
  const { data: templates = [], isLoading: templatesLoading } = useTemplates()
  // Templates that reference this drill inside their activities; each will show
  // a missing activity once the drill is gone.
  const usedIn = templates.filter((t) => t.activities.some((a) => a.drillId === drill.id)).length

  const remove = () => {
    del.mutate(
      { id: drill.id },
      {
        onSuccess: () => {
          afterDelete?.()
          onClose()
        },
      },
    )
  }

  return (
    <Modal
      title="Delete drill"
      sub={drill.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            style={{ background: 'var(--m-pdf)' }}
            onClick={remove}
            disabled={del.isPending}
          >
            <Icon.trash />
            {del.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
        Deleting <b style={{ color: 'var(--ink)' }}>{drill.title}</b> removes it from the club library.
      </p>
      {!templatesLoading && usedIn > 0 && (
        <p style={{ fontSize: 14.5, lineHeight: 1.55 }}>
          This drill is used in {usedIn} template{usedIn !== 1 ? 's' : ''}; they will show a missing activity where it
          was.
        </p>
      )}
      <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        Sessions already built keep their timing and show a removed drill placeholder.
      </p>
      {del.isError && (
        <p className="muted" style={{ color: 'var(--m-pdf)', fontSize: 13.5 }}>
          Could not delete. Try again.
        </p>
      )}
    </Modal>
  )
}
