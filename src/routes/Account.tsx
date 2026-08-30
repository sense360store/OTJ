// Account self-service, open to every role, reached from the identity block
// in the sidebar and the mobile top bar. Profile details write through the
// profiles_update_self policy; the password and email changes go through the
// auth client on the signed-in session. Role and club render read-only:
// changing them, and removing an account, stays with club admins.
// REVIEW: part of the auth flow (signed-in password and email updates).
//
// VISUAL-02 brought it onto the shared system: PageHeader, Card, Button, the
// field primitives and the Note. Nothing about what it writes moved. What
// changed is which vocabulary draws it, and two accessibility repairs that
// belong to a visual pass: an outcome is a Note with an icon and a live
// region rather than coloured text, and focus is placed deliberately where a
// successful write removes or disables the control that had it.
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useClub, useMyCapabilities, useRemoveAvatar, useTeams, useUpdateMyProfile, useUploadAvatar } from '../lib/queries'
import { ROLE_LABELS } from '../lib/data'
import { Icon } from '../components/icons'
import type { IconComponent } from '../components/icons'
import { UserAvatar } from '../components/UserAvatar'
import { Loading } from '../components/ui'
import { Button, Card, Note, PageHeader, SelectField, TextField } from '../components/primitives'

function joinedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// The outcome of one write, in the two kinds this screen can report. Named
// Outcome rather than Note so the shared primitive keeps its own name here.
type Outcome = { kind: 'ok' | 'error'; text: string } | null

// Every message on this page, in one treatment. It was plain coloured text,
// which carried its meaning by colour alone and announced nothing; it is the
// shared Note now, so success and failure each carry an icon and a border as
// well as a hue, and each is a live region of the right urgency. Keyed by
// kind so a success replaced by a failure is a fresh insertion rather than a
// text swap inside a region already announced.
function OutcomeNote({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null
  const error = outcome.kind === 'error'
  return (
    <Note
      key={outcome.kind}
      className="account-note"
      tone={error ? 'danger' : 'success'}
      role={error ? 'alert' : 'status'}
    >
      {outcome.text}
    </Note>
  )
}

// One contained section. The heading is an h2 under the page's single h1, so
// the page has a real outline; the title and its line of context take the
// shared type scale rather than two inline sizes.
function SectionCard({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <Card className="account-section">
      <h2 className="account-section-title">{title}</h2>
      <p className="account-section-sub">{sub}</p>
      {children}
    </Card>
  )
}

function PhotoRow() {
  const { profile } = useAuth()
  const upload = useUploadAvatar()
  const remove = useRemoveAvatar()
  const inputRef = useRef<HTMLInputElement>(null)
  // The visible action, which is where focus goes when Remove photo succeeds:
  // that button unmounts with the photo it removed, and focus would otherwise
  // fall to the document body.
  const pickRef = useRef<HTMLButtonElement>(null)
  const [outcome, setOutcome] = useState<Outcome>(null)
  // A request rather than state, so placing the focus renders nothing.
  const wantsFocus = useRef(false)
  const busy = upload.isPending || remove.isPending

  /* Focus is REQUESTED in the success callback and PLACED here, on the render
     where the button is enabled again. It cannot be placed in the callback
     itself: TanStack runs a per-call onSuccess inside its notify batch before
     it notifies its listeners, so React has not re-rendered yet and the
     button still carries the `disabled` the in-flight render gave it.
     Focusing a disabled control is a no-op, so the repair silently did
     nothing and focus landed on the document body anyway. Codex. */
  useEffect(() => {
    if (busy || !wantsFocus.current) return
    wantsFocus.current = false
    pickRef.current?.focus()
  }, [busy])

  const pick = (file: File | null) => {
    if (!file) return
    setOutcome(null)
    upload.mutate(
      { file },
      {
        onSuccess: () => setOutcome({ kind: 'ok', text: 'Photo updated.' }),
        onError: (e) => setOutcome({ kind: 'error', text: e.message }),
      },
    )
  }

  return (
    <div className="account-photo-block">
      <div className="account-photo">
        <UserAvatar name={profile?.full_name} fallbackText={profile?.avatar} path={profile?.avatar_url} size={72} />
        <div className="account-photo-acts">
          {/* The real control is the button; the input is the file picker it
              opens and is never reached on its own. */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              pick(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
          <Button ref={pickRef} icon={Icon.upload} disabled={busy} onClick={() => inputRef.current?.click()}>
            {upload.isPending ? 'Uploading…' : profile?.avatar_url ? 'Change photo' : 'Add photo'}
          </Button>
          {profile?.avatar_url && (
            <Button
              variant="quiet"
              icon={Icon.x}
              disabled={busy}
              onClick={() => {
                setOutcome(null)
                remove.mutate(undefined, {
                  onSuccess: () => {
                    setOutcome({ kind: 'ok', text: 'Photo removed. Your initials show instead.' })
                    wantsFocus.current = true
                  },
                  onError: (e) => setOutcome({ kind: 'error', text: e.message }),
                })
              }}
            >
              {remove.isPending ? 'Removing…' : 'Remove photo'}
            </Button>
          )}
        </div>
      </div>
      <OutcomeNote outcome={outcome} />
    </div>
  )
}

function NameRow() {
  const { profile } = useAuth()
  const update = useUpdateMyProfile()
  const [draft, setDraft] = useState(profile?.full_name ?? '')
  const [outcome, setOutcome] = useState<Outcome>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const changed = draft.trim() !== '' && draft.trim() !== (profile?.full_name ?? '')

  const save = () => {
    setOutcome(null)
    update.mutate(
      { fullName: draft.trim() },
      {
        onSuccess: () => {
          setOutcome({ kind: 'ok', text: 'Name updated.' })
          // Saving makes the name unchanged, which disables Save. Focus was on
          // it whenever the coach clicked rather than pressed Enter, so it
          // returns to the field they were editing.
          inputRef.current?.focus()
        },
        onError: (e) => setOutcome({ kind: 'error', text: e.message }),
      },
    )
  }

  return (
    <div className="account-name-block">
      <div className="account-form-row">
        <TextField
          id="full-name"
          ref={inputRef}
          label="Full name"
          value={draft}
          placeholder="First and last name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && changed && save()}
        />
        <Button variant="primary" icon={Icon.check} disabled={!changed || update.isPending} onClick={save}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <OutcomeNote outcome={outcome} />
    </div>
  )
}

function TeamRow() {
  const { profile } = useAuth()
  const { data: teams = [] } = useTeams()
  const update = useUpdateMyProfile()
  const [outcome, setOutcome] = useState<Outcome>(null)

  return (
    <div className="account-team-block">
      <SelectField
        id="default-team"
        className="account-team"
        label="Default team"
        hint="New sessions you plan start on this team. It never limits what you can see."
        value={profile?.team_id ?? ''}
        disabled={update.isPending}
        onChange={(e) => {
          setOutcome(null)
          update.mutate(
            { teamId: e.target.value || null },
            {
              onSuccess: () => setOutcome({ kind: 'ok', text: 'Default team updated.' }),
              onError: (err) => setOutcome({ kind: 'error', text: err.message }),
            },
          )
        }}
      >
        <option value="">No team</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </SelectField>
      <OutcomeNote outcome={outcome} />
    </div>
  )
}

// The team setting in the Profile card. A coach gets the Default team control:
// it seeds the team on sessions they plan. A parent does not plan, and their
// dashboard and schedule scope is their member_teams, set by an admin, so the
// control would do nothing; they get a quiet line in its place. Presentational
// over canPlan so the static renderer covers which one shows, the same style
// as HomeSwitch; canPlan is sessions.create, the test the Home dispatch uses.
export function TeamSetting({ canPlan, control }: { canPlan: boolean; control: ReactNode }) {
  if (canPlan) return <>{control}</>
  return <p className="account-team-admin">Your team is set by a club admin.</p>
}

function PasswordForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [busy, setBusy] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setOutcome(null)
    if (password !== confirm) {
      setOutcome({ kind: 'error', text: 'The passwords do not match.' })
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setOutcome({ kind: 'error', text: error.message })
      return
    }
    setPassword('')
    setConfirm('')
    setOutcome({ kind: 'ok', text: 'Password changed. Use it next time you sign in.' })
    // Both fields are empty again, which disables the submit that had focus.
    firstRef.current?.focus()
  }

  return (
    <form className="account-form" onSubmit={(e) => void submit(e)}>
      <div className="account-form-row">
        <TextField
          id="new-password"
          ref={firstRef}
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          placeholder="Choose a password"
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <TextField
          id="confirm-password"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          placeholder="Type it again"
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        <Button variant="primary" type="submit" disabled={busy || !password || !confirm}>
          {busy ? 'Saving…' : 'Change password'}
        </Button>
      </div>
      <OutcomeNote outcome={outcome} />
    </form>
  )
}

function EmailForm() {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [busy, setBusy] = useState(false)
  const fieldRef = useRef<HTMLInputElement>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setOutcome(null)
    const next = email.trim()
    if (next.toLowerCase() === (user?.email ?? '').toLowerCase()) {
      setOutcome({ kind: 'error', text: 'That is already your sign in email.' })
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ email: next })
    setBusy(false)
    if (error) {
      setOutcome({ kind: 'error', text: error.message })
      return
    }
    setEmail('')
    setOutcome({
      kind: 'ok',
      text: `A confirmation email is on its way to ${next}. Your sign in email changes only once you confirm it from there.`,
    })
    // The field is empty again, which disables the submit that had focus.
    fieldRef.current?.focus()
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <p className="account-lede">
        You sign in as <b>{user?.email}</b>. Changing it sends a confirmation email to the new address; the change
        completes only when it is confirmed.
      </p>
      <div className="account-form-row">
        <TextField
          id="new-email"
          ref={fieldRef}
          label="New email"
          type="email"
          autoComplete="email"
          value={email}
          placeholder="you@club.com"
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button variant="primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Sending…' : 'Change email'}
        </Button>
      </div>
      <OutcomeNote outcome={outcome} />
    </form>
  )
}

// One destination row, shared by the Feedback entry point and the admin
// links, which were the same fifteen inline declarations written twice. The
// class owns the row, its 44px minimum and its glyph sizes.
function NavRow({ icon: Ico, label, sub, to }: { icon: IconComponent; label: string; sub: string; to: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" className="account-link" onClick={() => navigate(to)}>
      <Ico className="account-link-icon" aria-hidden="true" />
      <span className="account-link-text">
        <b>{label}</b>
        <span>{sub}</span>
      </span>
      <Icon.chevR className="account-link-chev" aria-hidden="true" />
    </button>
  )
}

// The admin screens are linked only from the desktop sidebar; the mobile
// bottom nav carries no admin entries, so this section is how an admin
// reaches them on a phone. Each row gates on the same capability id as the
// sidebar's ITEM_CAP map, and a member with no admin capability sees no
// section at all.
const ADMIN_LINKS: { cap: string; label: string; sub: string; icon: IconComponent; to: string }[] = [
  { cap: 'club.manage', label: 'Club', sub: 'Name, motto and crest', icon: Icon.star, to: '/admin/club' },
  { cap: 'users.manage', label: 'Users', sub: 'Members, invites and roles', icon: Icon.users, to: '/admin/users' },
  { cap: 'teams.manage', label: 'Teams', sub: 'The club teams', icon: Icon.flag, to: '/admin/teams' },
  { cap: 'club.manage', label: 'Spond', sub: 'Attendance mirrored from Spond', icon: Icon.link, to: '/admin/spond' },
]

export function AdminSection({ caps }: { caps: Set<string> }) {
  const links = ADMIN_LINKS.filter((l) => caps.has(l.cap))
  if (links.length === 0) return null
  return (
    <SectionCard title="Admin" sub="Club management screens your capabilities open.">
      {links.map((l) => (
        <NavRow key={l.to} icon={l.icon} label={l.label} sub={l.sub} to={l.to} />
      ))}
    </SectionCard>
  )
}

// The feedback log's entry point, open to every role: it lives here rather
// than in the nav because it is an occasional surface, not a daily one. The
// row is the same NavRow as the admin rows above, so the page reads as one
// list style by construction rather than by two copies agreeing.
function FeedbackSection() {
  return (
    <SectionCard title="Feedback" sub="Help shape the Hub. The log is club wide, so check it before filing.">
      <NavRow
        icon={Icon.note}
        label="Feedback log"
        sub="Feature requests, bugs and where they stand"
        to="/feedback"
      />
    </SectionCard>
  )
}

// Role, club and joined date: read only facts, so a description list rather
// than a row of spans. Each value can be club data of any length and wraps.
function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="account-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export function Account() {
  const { profile, role, profileLoading } = useAuth()
  const { data: club } = useClub()
  const { caps } = useMyCapabilities()
  // The Default team control seeds the planner default, which parents do not
  // have, so it follows the same coaching write capability the Home dispatch
  // uses.
  const canPlan = caps.has('sessions.create')

  if (profileLoading) return <Loading />

  return (
    <div className="account">
      <PageHeader title="Account" sub="Your details, how you sign in, and your club membership." />

      <SectionCard title="Profile" sub="How you appear across the club. Changes show everywhere at once.">
        <PhotoRow />
        <NameRow />
        <TeamSetting canPlan={canPlan} control={<TeamRow />} />
      </SectionCard>

      <SectionCard title="Security" sub="Change your password or the email you sign in with.">
        <PasswordForm />
        <EmailForm />
      </SectionCard>

      <SectionCard title="Membership" sub="Set by your club admins; shown here for reference.">
        <dl className="account-facts">
          <FactRow label="Role" value={role ? ROLE_LABELS[role] : '—'} />
          <FactRow label="Club" value={club?.name ?? 'Ossett Town Juniors'} />
          <FactRow label="Joined" value={profile?.created_at ? joinedLabel(profile.created_at) : '—'} />
        </dl>
        <p className="account-section-note">
          Roles and club membership are managed by admins, and so is removing an account. Ask a club admin if you need
          either changed.
        </p>
      </SectionCard>

      <FeedbackSection />

      <AdminSection caps={caps} />
    </div>
  )
}
