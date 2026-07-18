// Pure helpers for the Roster, kept out of the component module so they can be
// unit tested and so the component file exports only components.

// The typed confirmation gate for a permanent deletion: the admin must type the
// player's current display name exactly (trimmed) before the destructive button
// enables.
export function deleteConfirmed(typed: string, displayName: string): boolean {
  return typed.trim() !== '' && typed.trim() === displayName.trim()
}
