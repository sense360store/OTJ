import { createClient } from '@supabase/supabase-js'

// The single configured Supabase client for the whole app. Only the anon
// public key belongs here. It ships to the browser by design and is gated by
// Row-Level Security. The service-role key must never reach this file.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase configuration. Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
