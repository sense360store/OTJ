// OTJ Training Hub, read-content-share Edge Function (Content Sharing PR 2).
//
// The FIRST public, anonymous Edge Function in the project. verify_jwt is OFF
// (declared in supabase/config.toml, version controlled and reviewable). It
// resolves an opaque public DRILL share to its stored, sanitised snapshot.
//
// It holds the service role (to read content_shares, which has no client
// policy, and to sign private media), so it is review gated on the same footing
// as invite-user and remove-user. It reaches the database ONLY through the
// narrow read_public_share SECURITY DEFINER function, which verifies the secret
// hash, revoked_at, expires_at, the per club kill switch, the snapshot version,
// the drill-only kind and every dependency's current rights, and returns only
// the safe public snapshot plus the explicit list of eligible stored media
// paths to sign. This function signs only those exact paths, never a caller
// supplied one.
//
// Hard rules honoured here:
//   - only shareId and secret are accepted, in a POST body; the secret is never
//     read from a query string or the URL path (it lives in the URL fragment
//     client side and reaches here only in the POST body);
//   - every lifecycle failure (unknown, wrong secret, revoked, expired,
//     disabled) returns the identical neutral { status: 'unavailable' }, so
//     there is no oracle; a transport failure is a distinct { status: 'error' }
//     because it reveals nothing about the link's lifecycle;
//   - no content_shares column, hash, source id, club id or member id is ever
//     returned; the snapshot carries no internal identifier;
//   - Cache-Control: no-store and security headers on every response;
//   - CORS is locked to APP_ORIGIN; only POST and OPTIONS are allowed;
//   - the secret and the snapshot are never logged.
//
// This function is review gated. Deploy from disk via the CLI and verify by
// reading the deployed source back byte for byte, plus a positive check that it
// is anon reachable while every other function stays verify_jwt = true.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { sha256Hex, validatePublicDrillSnapshot } from '../_shared/share.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_ORIGIN = Deno.env.get('APP_ORIGIN') ?? ''

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A base64url secret with generous bounds (a 32 byte secret is 43 chars).
const SECRET_RE = /^[A-Za-z0-9_-]{20,200}$/
const MAX_BODY_BYTES = 4 * 1024
const SIGNED_URL_TTL_SECONDS = 600 // ten minutes: long enough to load, short enough to limit a leak

const corsHeaders = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Response headers: no caching of a snapshot, no sniffing, no referrer.
const secureHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: secureHeaders })
}

// The single neutral unavailable response for every lifecycle failure.
function unavailable(): Response {
  return reply(200, { status: 'unavailable' })
}

// -------------------------------------------------------------------------
// Best-effort in-memory rate limiter.
//
// HONEST LIMITATION: this is per worker and NOT globally durable. A determined
// attacker hitting many workers is not bounded by it. It is a first line that
// bounds a single worker's exposure to a burst; a durable, distributed limit is
// a platform level follow up (a Supabase or edge platform rate limit, or a
// shared store the function can reach), recorded as a PR 2 design gate in the
// content sharing boundary doc. The hard input caps below (bounded token, body
// size, method allow-list, indexed single-row lookup) are the real cheap
// protections that hold per request regardless.
// -------------------------------------------------------------------------
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 60
const buckets = new Map<string, { count: number; resetAt: number }>()
const IP_SALT = crypto.randomUUID() // per process; never logged, never persisted

function hashIp(ip: string): string {
  // A small non-cryptographic hash of a salted IP, used only as an in-memory
  // bucket key. The raw IP is never stored or logged.
  let h = 2166136261
  const s = IP_SALT + ip
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

function rateLimited(keys: string[]): boolean {
  const now = Date.now()
  if (buckets.size > 20_000) buckets.clear() // coarse memory bound
  let limited = false
  for (const key of keys) {
    const b = buckets.get(key)
    if (!b || now > b.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
      continue
    }
    b.count += 1
    if (b.count > MAX_PER_WINDOW) limited = true
  }
  return limited
}

function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get('x-real-ip')
  return real ? real.trim() : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply(405, { error: 'method not allowed' })

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Fail closed without leaking configuration detail.
    return reply(503, { status: 'error' })
  }

  // Bounded body.
  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return reply(413, { status: 'error' })
  let body: Record<string, unknown>
  try {
    body = raw ? JSON.parse(raw) : {}
  } catch {
    return unavailable()
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return unavailable()

  const shareId = typeof body.shareId === 'string' ? body.shareId : ''
  const secret = typeof body.secret === 'string' ? body.secret : ''

  // Malformed inputs are indistinguishable from a bad link: neutral unavailable.
  if (!UUID_RE.test(shareId) || !SECRET_RE.test(secret)) return unavailable()

  // Rate limit by shareId, and by a hashed IP when one is available; otherwise
  // fall back to limiting by shareId alone.
  const ip = clientIp(req)
  const keys = ip ? [`id:${shareId}`, `ip:${hashIp(ip)}`] : [`id:${shareId}`]
  if (rateLimited(keys)) return reply(429, { status: 'unavailable' })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const secretHash = '\\x' + (await sha256Hex(secret))

  // deno-lint-ignore no-explicit-any
  let result: any
  try {
    const { data, error } = await admin.rpc('read_public_share', {
      p_share_id: shareId,
      p_secret_hash: secretHash,
    })
    if (error) {
      console.error('read-content-share: read rpc failed', { code: error.code ?? 'unknown' })
      return reply(500, { status: 'error' })
    }
    result = data
  } catch (err) {
    console.error('read-content-share: unexpected failure', { code: (err as { name?: string })?.name ?? 'unknown' })
    return reply(500, { status: 'error' })
  }

  if (!result || result.status !== 'ok' || !result.snapshot) return unavailable()

  const snapshot = result.snapshot as Record<string, unknown>
  const toSign: Array<{ ref: string; path: string }> = Array.isArray(result.media) ? result.media : []

  // Sign only the exact eligible paths the definer function named. Inject the
  // short lived signed URL into the matching media entry by ref.
  let signFailures = 0
  if (toSign.length > 0 && Array.isArray(snapshot.media)) {
    const byRef = new Map<string, string>()
    for (const item of toSign) {
      if (!item || typeof item.ref !== 'string' || typeof item.path !== 'string') continue
      const { data, error } = await admin.storage.from('media').createSignedUrl(item.path, SIGNED_URL_TTL_SECONDS)
      if (error || !data?.signedUrl) {
        signFailures += 1
        continue
      }
      byRef.set(item.ref, data.signedUrl)
    }
    for (const m of snapshot.media as Array<Record<string, unknown>>) {
      const ref = typeof m.ref === 'string' ? m.ref : ''
      const url = byRef.get(ref)
      if (url) m.url = url
    }
  }

  // Validate the projection schema before responding: an unknown or tampered
  // shape yields the neutral unavailable state rather than anything else.
  if (!validatePublicDrillSnapshot(snapshot)) {
    console.error('read-content-share: snapshot failed public validation')
    return unavailable()
  }

  console.log('read-content-share: served', { signFailures })
  return reply(200, { status: 'ok', snapshot })
})
