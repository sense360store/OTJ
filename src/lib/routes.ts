// Route paths that more than one module has to agree on.
//
// This exists because they drifted: the register route was declared with a
// :sessionId parameter while the screen destructured :id, so every
// navigation to it rendered "Session not found". A path and the parameter
// name inside it are one fact, so they live in one place, and the href is
// derived from the pattern rather than written out again beside it.
//
// Only the paths with a parameter that a component reads back need to be
// here. A static path is its own single source of truth.

// The parameter name the register route declares and the register screen
// reads. Exported so useParams cannot be given a different key.
export const SESSION_ID_PARAM = 'sessionId'

// The register route, relative, as App.tsx declares it inside the shell.
export const REGISTER_ROUTE = `session-day/:${SESSION_ID_PARAM}/register`

// The same route as a link, derived from the pattern so the two cannot
// disagree.
export function registerPath(sessionId: string): string {
  return '/' + REGISTER_ROUTE.replace(`:${SESSION_ID_PARAM}`, sessionId)
}
