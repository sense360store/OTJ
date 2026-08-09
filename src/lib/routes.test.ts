import { describe, expect, it } from 'vitest'
import { matchPath } from 'react-router-dom'
import { REGISTER_ROUTE, SESSION_ID_PARAM, registerPath } from './routes'

// The register route was shipped broken: the route declared :sessionId and
// the screen destructured :id, so every navigation rendered "Session not
// found". These tests pin the three things that have to agree, using react
// router's own matcher rather than a second copy of the pattern.

describe('the register route', () => {
  it('matches the link it generates, and yields the session id back', () => {
    const match = matchPath('/' + REGISTER_ROUTE, registerPath('s-123'))
    expect(match).not.toBeNull()
    expect(match?.params[SESSION_ID_PARAM]).toBe('s-123')
  })

  it('hangs off the session day path, so back goes where a coach expects', () => {
    expect(registerPath('s-123')).toBe('/session-day/s-123/register')
  })

  it('declares exactly the parameter the screen reads', () => {
    // The screen calls useParams()[SESSION_ID_PARAM]. If the pattern stopped
    // naming that parameter, the lookup would silently be undefined.
    expect(REGISTER_ROUTE).toContain(':' + SESSION_ID_PARAM)
  })

  it('leaves nothing unsubstituted in a generated link', () => {
    expect(registerPath('s-123')).not.toContain(':')
  })
})
