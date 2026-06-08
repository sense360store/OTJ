# OTJ Training Hub

A web app for Ossett Town Juniors coaches to build, store and run training sessions. See `CLAUDE.md` for the stack, architecture and build order.

## Running locally

The front-end runs against a local Supabase stack (Postgres, Auth and Storage) in Docker.

Prerequisites: Node 20 or newer, and Docker running.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the local Supabase stack:

   ```bash
   npx supabase start
   ```

   Copy `.env.example` to `.env`, then paste the API URL and anon key printed by `supabase start` into `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

3. Apply the migration and then the seed to the local database:

   ```bash
   npx supabase db reset
   ```

4. Run the front-end:

   ```bash
   npm run dev
   ```

5. Sign in with the seeded demo coach: `coach@ossetttownjnr.com` / `training123`. This credential is local only and works only against the local Supabase stack.

The seed is for local development only. Production data comes from invite-based sign-up, not from this seed.
