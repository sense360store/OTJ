// COACH-11. Reopens the week plan editor on a draft that went to the Drill
// Maker. Mounted by the two screens that can open that editor (Templates
// and the programme page), so the return trip lands wherever it left from.
// An editing draft whose template is no longer in the list has nothing to
// reopen on and renders nothing; a new template's draft needs no row.
//
// Its own file rather than a third export of PlanDrillAuthoring, because
// the week plan editor calls that hook and this mounts the week plan
// editor: one module importing the other both ways is a cycle.
import { useState } from 'react'
import { TemplateFormModal } from './TemplateFormModal'
import { useAuthoringReturn } from './PlanDrillAuthoring'
import type { TemplateInput } from '../lib/queries'
import type { Template } from '../lib/data'

export function RestoredTemplateEditor({ templates }: { templates: readonly Template[] }) {
  const returned = useAuthoringReturn<TemplateInput>('template')
  const [open, setOpen] = useState(true)
  if (!returned || !open) return null
  const template = returned.id ? templates.find((t) => t.id === returned.id) : undefined
  if (returned.id && !template) return null
  return <TemplateFormModal template={template} initialForm={returned.draft} onClose={() => setOpen(false)} />
}
