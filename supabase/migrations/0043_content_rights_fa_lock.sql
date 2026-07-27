-- =====================================================================
-- OTJ Training Hub, migration 0043_content_rights_fa_lock: refuse to raise
-- the rights of England Football derived content above club only.
--
-- WHY THIS EXISTS
--
-- Migration 0038 added the rights column, classified every existing row and
-- proved the invariant that no England Football derived row is publishable.
-- It proved that invariant ONCE, at backfill time. Nothing has enforced it
-- since: the owner-or-manager UPDATE policy on drills, sessions, programmes,
-- templates and media covers every column, so any member holding the write
-- arm could set rights = 'public_full' on an FA imported row and publish it.
-- Until now no screen offered that, which is the only reason it never
-- happened. This change adds the classification workflow that does offer it,
-- so the invariant has to become an enforced rule before the control ships.
--
-- The rule, stated plainly: a row whose recorded source is England Football
-- Learning stays 'internal_only'. It may be edited, used, planned from and
-- shared inside the club exactly as before. It may not be classified for a
-- public link, by any client, through any path, including a hand written
-- PostgREST call. The club's permission to use England Football content is
-- for its own non commercial coaching (CLAUDE.md, Third-party content), and
-- a public link is not that.
--
-- WHAT IT DOES
--
--   1. public.content_rights_fa_lock(), a BEFORE INSERT OR UPDATE trigger
--      function that refuses any row whose rights are not 'internal_only'
--      while its recorded source is England Football derived.
--   2. That trigger on all five rights carrying tables.
--   3. A self verification block proving the invariant holds for existing
--      data before the trigger is trusted to hold it going forward.
--
-- WHAT IT DOES NOT DO
--
--   - It does not change any row. No reclassification, no backfill.
--   - It does not change a policy, a grant, a capability or a role.
--   - It does not touch content_shares, the lifecycle RPC, the read path,
--      the secret model, expiry or the kill switch.
--   - It does not restrict a non England Football source. Recording some
--      other source is evidence, not proof of a restriction, so the club may
--      still classify that content; the UI asks for an explicit confirmation
--      first. Only the England Football case is proven and therefore locked.
--
-- PROVENANCE IS THE SOURCE COLUMNS, NEVER THE RIGHTS VALUE
--
-- The guard reads source_url, source_label and (drills) source_key. It never
-- infers provenance from rights being 'internal_only', which proves nothing:
-- every row created since 0038 is internal_only by the column default,
-- including content the club wrote itself. The same rule is mirrored in
-- supabase/functions/_shared/share.ts (rowProvenance) and src/lib/fa.ts
-- (isFaUrl) for the coach facing wording; this is the boundary.
--
-- ROLLBACK
--
--   drop trigger content_rights_fa_lock_drills on public.drills;
--   drop trigger content_rights_fa_lock_sessions on public.sessions;
--   drop trigger content_rights_fa_lock_programmes on public.programmes;
--   drop trigger content_rights_fa_lock_templates on public.templates;
--   drop trigger content_rights_fa_lock_media on public.media;
--   drop function public.content_rights_fa_lock();
--
-- Rolling back restores the pre 0043 position, in which an England Football
-- derived row can be classified for public sharing by any member holding the
-- write arm. It is a break-glass step, not a routine one.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1: the guard
-- ---------------------------------------------------------------------

-- Reads the candidate row generically through to_jsonb so one function serves
-- all five tables, including drills' extra source_key. SECURITY INVOKER: the
-- guard needs no privilege of its own, and content_rights_is_fa_url is
-- immutable and already executable by authenticated. search_path is pinned to
-- empty and every reference is schema qualified.
create or replace function public.content_rights_fa_lock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
begin
  -- Club only is always allowed, on every row, from every path. Only raising
  -- the level is guarded, so lowering an FA row (or leaving it alone) never
  -- trips this, and an ordinary edit of an FA drill is untouched.
  if new.rights = 'internal_only'::public.content_rights then
    return new;
  end if;

  if public.content_rights_is_fa_url(v_row ->> 'source_url')
     or public.content_rights_is_fa_url(v_row ->> 'source_key')
     or btrim(coalesce(v_row ->> 'source_label', '')) = 'England Football Learning'
  then
    raise exception
      'England Football content stays inside the club and cannot be made public.'
      using errcode = '42501',
            hint = 'Its sharing level must remain club only.';
  end if;

  return new;
end;
$$;

comment on function public.content_rights_fa_lock() is
  $$BEFORE INSERT OR UPDATE guard (0043_content_rights_fa_lock.sql) refusing any rights value above internal_only on a row whose recorded source is England Football derived (source_url or drills.source_key on an England Football Learning host, or the England Football Learning source label). Provenance is read from the source columns, never inferred from the rights value. Raises 42501. Applied to drills, sessions, programmes, templates and media. See docs/security/content-sharing-boundary.md.$$;

-- ---------------------------------------------------------------------
-- PART 2: the triggers
-- ---------------------------------------------------------------------
--
-- No UPDATE OF column list: the guard must also catch a row that acquires an
-- England Football source_url while already classified as publishable, which
-- an rights-only column list would miss. The function returns immediately for
-- the common internal_only case, so the cost on ordinary writes is one enum
-- comparison.

create trigger content_rights_fa_lock_drills
  before insert or update on public.drills
  for each row execute function public.content_rights_fa_lock();

create trigger content_rights_fa_lock_sessions
  before insert or update on public.sessions
  for each row execute function public.content_rights_fa_lock();

create trigger content_rights_fa_lock_programmes
  before insert or update on public.programmes
  for each row execute function public.content_rights_fa_lock();

create trigger content_rights_fa_lock_templates
  before insert or update on public.templates
  for each row execute function public.content_rights_fa_lock();

create trigger content_rights_fa_lock_media
  before insert or update on public.media
  for each row execute function public.content_rights_fa_lock();

-- ---------------------------------------------------------------------
-- PART 3: self verification
-- ---------------------------------------------------------------------
--
-- The trigger holds the invariant from here on. This proves it already holds,
-- so the migration cannot succeed against data the guard would have refused.
-- A failure here means a row was published from England Football derived
-- content before the lock existed and must be reclassified by hand first.

do $$
declare
  v_bad integer;
  v_triggers integer;
begin
  select count(*) into v_bad from (
    select 1 from public.drills
      where rights <> 'internal_only'
        and (public.content_rights_is_fa_url(source_url)
             or public.content_rights_is_fa_url(source_key)
             or btrim(coalesce(source_label, '')) = 'England Football Learning')
    union all
    select 1 from public.sessions
      where rights <> 'internal_only'
        and (public.content_rights_is_fa_url(source_url)
             or btrim(coalesce(source_label, '')) = 'England Football Learning')
    union all
    select 1 from public.programmes
      where rights <> 'internal_only'
        and (public.content_rights_is_fa_url(source_url)
             or btrim(coalesce(source_label, '')) = 'England Football Learning')
    union all
    select 1 from public.templates
      where rights <> 'internal_only'
        and (public.content_rights_is_fa_url(source_url)
             or btrim(coalesce(source_label, '')) = 'England Football Learning')
    union all
    select 1 from public.media
      where rights <> 'internal_only'
        and (public.content_rights_is_fa_url(source_url)
             or btrim(coalesce(source_label, '')) = 'England Football Learning')
  ) bad;

  if v_bad > 0 then
    raise exception
      '0043 self verification failed: % England Football derived row(s) are classified above club only', v_bad;
  end if;

  select count(*) into v_triggers
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not t.tgisinternal
     and t.tgname in (
       'content_rights_fa_lock_drills', 'content_rights_fa_lock_sessions',
       'content_rights_fa_lock_programmes', 'content_rights_fa_lock_templates',
       'content_rights_fa_lock_media');

  if v_triggers <> 5 then
    raise exception '0043 self verification failed: expected 5 rights lock triggers, found %', v_triggers;
  end if;
end $$;
