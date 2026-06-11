// @supabase/supabase-js builds a realtime client when createClient runs at
// import time, and that construction needs a global WebSocket. Node 20 has
// none, while Node 22 plus and every browser do, so supply one for the test
// process. No test opens a realtime connection, so this only lets the client
// construct. See src/lib/supabase.ts.
import { WebSocket as NodeWebSocket } from 'ws'

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = NodeWebSocket as unknown as typeof globalThis.WebSocket
}
