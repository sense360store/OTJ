// The fixed capability catalogue: the single vocabulary of the permission
// system. This list and the check constraint in
// supabase/migrations/0010_rbac.sql must match exactly; adding or removing a
// capability is a migration, never a runtime change.
//
// manage_any means edit and delete items the user does not own. Owners manage
// their own items while they hold the matching create capability (the
// 0009_parent_owner_writes guard: a member demoted to a read-only role loses
// writes on content they own). Templates carry no owner, so templates.manage
// is the only write path beyond creating one. Postgres RLS enforces every
// capability through has_perm(); the UI only decides what to surface.

export const CAPABILITIES = [
  {
    key: 'drills.create',
    label: 'Create drills',
    description: 'Add drills to the club library.',
  },
  {
    key: 'drills.manage_any',
    label: 'Manage any drill',
    description: 'Edit and delete drills they do not own.',
  },
  {
    key: 'media.create',
    label: 'Create media',
    description: 'Upload files and add YouTube links to the media library.',
  },
  {
    key: 'media.manage_any',
    label: 'Manage any media',
    description: 'Delete media items they do not own.',
  },
  {
    key: 'templates.create',
    label: 'Create templates',
    description: 'Save new session templates for the club.',
  },
  {
    key: 'templates.manage',
    label: 'Manage templates',
    description: 'Edit and delete club templates.',
  },
  {
    key: 'sessions.create',
    label: 'Create sessions',
    description: 'Plan and save their own sessions.',
  },
  {
    key: 'sessions.manage_any',
    label: 'Manage any session',
    description: 'Edit, delete and drive sessions they do not own.',
  },
  {
    key: 'live.drive_any',
    label: 'Drive any live session',
    description: 'Run the live view for any club session.',
  },
  {
    key: 'import.fa',
    label: 'Import from England Football',
    description: 'Import a session page into drills, media and a template.',
  },
  {
    key: 'teams.manage',
    label: 'Manage teams',
    description: 'Add, rename and remove the club teams.',
  },
  {
    key: 'filters.manage',
    label: 'Manage filters',
    description: 'Edit the filter value lists used across the app.',
  },
  {
    key: 'roles.manage',
    label: 'Manage roles',
    description: 'Create roles and change what each role can do.',
  },
  {
    key: 'users.manage',
    label: 'Manage users',
    description: 'Invite and remove members and change their roles.',
  },
  {
    key: 'club.manage',
    label: 'Manage the club',
    description: 'Edit the club name, motto and crest.',
  },
] as const

export type Capability = (typeof CAPABILITIES)[number]['key']

export const CAPABILITY_KEYS: Capability[] = CAPABILITIES.map((c) => c.key)

// The capabilities that open an admin area screen. The Admin nav group shows
// for anyone holding at least one; each screen still checks its own.
export const ADMIN_AREA_CAPABILITIES: Capability[] = [
  'club.manage',
  'users.manage',
  'teams.manage',
  'roles.manage',
  'filters.manage',
]

// The Admin system role's locked ticks: enforced by the protect_admin_grants
// trigger in 0009, shown locked in the roles grid.
export const LOCKED_ADMIN_CAPABILITIES: Capability[] = ['roles.manage', 'users.manage']
