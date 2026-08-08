-- =====================================================================
-- OTJ Training Hub, migration 0043_content_rights_fa_lock: England Football
-- derived content stays inside the club, and keeps its recorded source.
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
-- THE TWO RULES
--
--   1. A row whose recorded source is England Football derived stays
--      'internal_only'. It may be edited, used, planned from and shared
--      inside the club exactly as before. It may not be classified for a
--      public link, by any client, through any path.
--
--   2. That recorded source cannot be removed. Without this, rule 1 is
--      cosmetic: the source columns are ordinary editable columns, so a
--      coach could clear the Source link field in the edit form (one save,
--      rights untouched, so rule 1 does not fire), reopen the form and
--      classify the now source-free row as public (a second save, no
--      evidence left for rule 1 to see). Two ordinary saves, no hand written
--      call, and an FA session is public. Rule 2 makes England Football
--      provenance sticky, so rule 1 has something to stand on.
--
--      Rule 2 is also correct on its own terms. The club's permission to use
--      England Football content is conditional on the source being recorded
--      and displayed (CLAUDE.md, Third-party content), so a write that
--      strips the attribution is one to refuse whatever it does to rights.
--      Changing one England Football source to another stays allowed; only
--      leaving the England Football set is refused.
--
-- WHAT IT DOES
--
--   1. Corrects public.content_rights_is_fa_url so its host extraction
--      matches the WHATWG URL parsing the two TypeScript implementations
--      use. See "The host rule" below.
--   2. public.content_rights_fa_evidence(url, key, label), the one rule,
--      stated once.
--   3. public.content_rights_fa_assert(...), the two refusals, stated once.
--   4. Five small per table BEFORE INSERT OR UPDATE trigger functions that
--      read their own columns directly, and their triggers.
--   5. A self verification block.
--
-- WHAT IT DOES NOT DO
--
--   - It does not change any row. No reclassification, no backfill.
--   - It does not change a policy, a grant, a capability or a role.
--   - It does not touch content_shares, the lifecycle RPC, the read path,
--     the secret model, expiry or the kill switch.
--   - It does not restrict a non England Football source. Recording some
--     other source is evidence, not proof of a restriction, so the club may
--     still classify that content; the UI asks for an explicit confirmation
--     first. Only the England Football case is proven and therefore locked.
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
-- THE HOST RULE
--
-- The 0038 body extracted the host with [^/:?#]+, which stops at the first
-- colon and treats userinfo as part of the host. The two TypeScript readers
-- use the WHATWG URL parser. They disagreed, and the disagreement ran the
-- permissive way for the database:
--
--   https://x@learn.englandfootball.com/a   SQL: not FA.  JS: FA.
--   https://learn.englandfootball.com:8080@evil.com/   SQL: FA. JS: not FA.
--   https:\\learn.englandfootball.com\a     SQL: not FA.  JS: FA.
--   '  https://learn.englandfootball.com/a' SQL: not FA.  JS: FA.
--
-- The body below takes the whole authority, translates backslashes (which
-- the WHATWG parser accepts for a special scheme), trims leading and
-- trailing whitespace (which it also strips), accepts any run of slashes
-- after the scheme including none (the WHATWG parser does the same for a
-- special scheme, so https:\learn..., https:/learn... and https:learn...
-- all carry the host to the JS readers), drops userinfo at the LAST @,
-- drops the port, and percent-decodes the remaining host (the WHATWG host
-- parser decodes too, so https://%6cearn.englandfootball.com is the
-- learning host to the JS readers). Where the SQL still cannot mirror the parser exactly (a
-- non special scheme such as foo:learn...), it errs the strict way: the
-- database may refuse a row the readers would not lock, never the reverse.
-- A read only check over the hosted data before writing this found zero
-- rows on any of the five tables carrying an @, a backslash or a port in
-- source_url, so no existing classification changes.
--
-- ROLLBACK
--
--   drop trigger content_rights_fa_lock_drills on public.drills;
--   drop trigger content_rights_fa_lock_sessions on public.sessions;
--   drop trigger content_rights_fa_lock_programmes on public.programmes;
--   drop trigger content_rights_fa_lock_templates on public.templates;
--   drop trigger content_rights_fa_lock_media on public.media;
--   drop function public.content_rights_fa_lock_drills();
--   drop function public.content_rights_fa_lock_sessions();
--   drop function public.content_rights_fa_lock_programmes();
--   drop function public.content_rights_fa_lock_templates();
--   drop function public.content_rights_fa_lock_media();
--   drop function public.content_rights_fa_assert(public.content_rights, boolean, boolean, text);
--   drop function public.content_rights_fa_evidence(text, text, text);
--   -- and restore content_rights_is_fa_url from its 0038 body.
--
-- Rolling back restores the pre 0043 position, in which an England Football
-- derived row can be classified for public sharing by any member holding the
-- write arm. It is a break-glass step, not a routine one.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- PART 1: the host rule, aligned with the WHATWG URL parser
-- ---------------------------------------------------------------------

create or replace function public.content_rights_is_fa_url(p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_host text;
  v_decoded text := '';
  v_i integer := 1;
  v_len integer;
  v_c text;
begin
  v_host :=
    regexp_replace(
      regexp_replace(
        coalesce(
          substring(
            translate(btrim(p_url), E'\\', '/')
            -- zero or more slashes after the scheme, as the WHATWG parser
            -- accepts for a special scheme (https:/h and https:h both
            -- carry the host), with backslashes already translated above
            from '^[a-zA-Z][a-zA-Z0-9+.-]*:/*([^/?#]*)'
          ),
          ''
        ),
        -- userinfo, up to and including the LAST @ in the authority
        '^.*@',
        ''
      ),
      -- the port
      ':[0-9]*$',
      ''
    );

  -- The WHATWG host parser percent-decodes, so %6cearn.englandfootball.com
  -- IS learn.englandfootball.com to the TypeScript readers. Decode valid
  -- %XX escapes the same way. Userinfo and the port were split on literal
  -- @ and : above, matching the parser, which also splits before decoding
  -- (an encoded %40 never introduces userinfo there or here; decoded it
  -- becomes an @ in the host, which matches no England Football host, and
  -- which the WHATWG parser rejects outright as a forbidden code point).
  v_len := length(v_host);
  while v_i <= v_len loop
    v_c := substr(v_host, v_i, 1);
    if v_c = '%' and v_i + 2 <= v_len
       and substr(v_host, v_i + 1, 2) ~ '^[0-9a-fA-F]{2}$' then
      v_decoded := v_decoded
        || convert_from(decode(substr(v_host, v_i + 1, 2), 'hex'), 'LATIN1');
      v_i := v_i + 3;
    else
      v_decoded := v_decoded || v_c;
      v_i := v_i + 1;
    end if;
  end loop;

  return lower(v_decoded)
    in ('learn.englandfootball.com', 'cdn.englandfootball.com');
end;
$$;

comment on function public.content_rights_is_fa_url(text) is
  $$True when a URL's host is an England Football Learning host (learn.englandfootball.com or cdn.englandfootball.com). Body corrected in 0043_content_rights_fa_lock.sql to match the WHATWG URL parsing src/lib/fa.ts isFaUrl and supabase/functions/_shared/share.ts isFaSourceUrl use: backslashes translated, whitespace trimmed, any run of slashes after the scheme accepted including none, userinfo dropped at the last @, port dropped, percent escapes in the host decoded. Used by the 0038 rights backfill and self verification, and by the 0043 England Football lock. See docs/security/content-sharing-boundary.md.$$;

-- ---------------------------------------------------------------------
-- PART 2: the evidence rule and the two refusals, each stated once
-- ---------------------------------------------------------------------

-- What counts as England Football provenance for a row: an England Football
-- Learning host in the source URL or (drills) in the importer's source key,
-- or the importer's own source label.
create or replace function public.content_rights_fa_evidence(p_url text, p_key text, p_label text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select public.content_rights_is_fa_url(p_url)
      or public.content_rights_is_fa_url(p_key)
      or btrim(coalesce(p_label, '')) = 'England Football Learning'
$$;

comment on function public.content_rights_fa_evidence(text, text, text) is
  $$True when a row's recorded source is England Football derived: an England Football Learning host in source_url or (drills) source_key, or the England Football Learning source label (0043_content_rights_fa_lock.sql). Provenance is read from the source columns only, never inferred from the rights value. Called by the five content_rights_fa_lock_* trigger functions, which are SECURITY INVOKER, so EXECUTE must stay available to the writing role.$$;

-- The two refusals. Raised as 42501 so a client can tell an England Football
-- refusal apart from an ordinary failure; the message is the sentence the
-- locked control shows, so both routes agree.
create or replace function public.content_rights_fa_assert(
  p_rights public.content_rights,
  p_new_fa boolean,
  p_old_fa boolean,
  p_op text
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  -- Rule 2, checked first: without it rule 1 is defeated by two ordinary
  -- saves. Changing one England Football source for another is allowed.
  if p_op = 'UPDATE' and p_old_fa and not p_new_fa then
    raise exception
      'England Football content keeps its recorded source, so the source cannot be cleared.'
      using errcode = '42501',
            hint = 'The club may use England Football content only with its source recorded and shown.';
  end if;

  -- Rule 1. Club only is always allowed, on every row, from every path, so
  -- lowering an England Football row (or leaving it alone) never trips this
  -- and an ordinary edit is untouched.
  if p_rights <> 'internal_only'::public.content_rights and (p_new_fa or p_old_fa) then
    raise exception
      'England Football content stays inside the club and cannot be made public.'
      using errcode = '42501',
            hint = 'Its sharing level must remain club only.';
  end if;
end;
$$;

comment on function public.content_rights_fa_assert(public.content_rights, boolean, boolean, text) is
  $$The two England Football refusals (0043_content_rights_fa_lock.sql): a row that is England Football derived cannot be raised above internal_only, and a row that IS England Football derived cannot have that provenance removed. Raises 42501. Called by the five content_rights_fa_lock_* trigger functions, which are SECURITY INVOKER, so EXECUTE must stay available to the writing role.$$;

-- ---------------------------------------------------------------------
-- PART 3: one small trigger function per table
-- ---------------------------------------------------------------------
--
-- Five explicit functions rather than one generic one over to_jsonb(new).
-- They read their own columns by name, so nothing serialises a whole row
-- (sessions.activities is a jsonb array that can run to kilobytes) on every
-- write, and the table each one guards is readable at a glance. Only drills
-- carry source_key; the others pass NULL, which is not England Football.

create or replace function public.content_rights_fa_lock_drills()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.content_rights_fa_assert(
    new.rights,
    public.content_rights_fa_evidence(new.source_url, new.source_key, new.source_label),
    case when tg_op = 'UPDATE'
      then public.content_rights_fa_evidence(old.source_url, old.source_key, old.source_label)
      else false end,
    tg_op);
  return new;
end $$;

create or replace function public.content_rights_fa_lock_sessions()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.content_rights_fa_assert(
    new.rights,
    public.content_rights_fa_evidence(new.source_url, null, new.source_label),
    case when tg_op = 'UPDATE'
      then public.content_rights_fa_evidence(old.source_url, null, old.source_label)
      else false end,
    tg_op);
  return new;
end $$;

create or replace function public.content_rights_fa_lock_programmes()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.content_rights_fa_assert(
    new.rights,
    public.content_rights_fa_evidence(new.source_url, null, new.source_label),
    case when tg_op = 'UPDATE'
      then public.content_rights_fa_evidence(old.source_url, null, old.source_label)
      else false end,
    tg_op);
  return new;
end $$;

create or replace function public.content_rights_fa_lock_templates()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.content_rights_fa_assert(
    new.rights,
    public.content_rights_fa_evidence(new.source_url, null, new.source_label),
    case when tg_op = 'UPDATE'
      then public.content_rights_fa_evidence(old.source_url, null, old.source_label)
      else false end,
    tg_op);
  return new;
end $$;

create or replace function public.content_rights_fa_lock_media()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.content_rights_fa_assert(
    new.rights,
    public.content_rights_fa_evidence(new.source_url, null, new.source_label),
    case when tg_op = 'UPDATE'
      then public.content_rights_fa_evidence(old.source_url, null, old.source_label)
      else false end,
    tg_op);
  return new;
end $$;

-- Trigger functions are not called by a client, so EXECUTE is withdrawn from
-- every client role, exactly as 0038 does for its audit trigger functions.
-- The two helpers above KEEP their EXECUTE: these functions are SECURITY
-- INVOKER, so the writing role evaluates them, and withdrawing EXECUTE there
-- would turn every content write into a permission denied error (the lesson
-- 0042 learned with the media path CHECK constraint).
revoke execute on function public.content_rights_fa_lock_drills() from public, anon, authenticated;
revoke execute on function public.content_rights_fa_lock_sessions() from public, anon, authenticated;
revoke execute on function public.content_rights_fa_lock_programmes() from public, anon, authenticated;
revoke execute on function public.content_rights_fa_lock_templates() from public, anon, authenticated;
revoke execute on function public.content_rights_fa_lock_media() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- PART 4: the triggers
-- ---------------------------------------------------------------------
--
-- No UPDATE OF column list: the guard must also catch a row that acquires an
-- England Football source while already classified as publishable, and a row
-- that loses one.

create trigger content_rights_fa_lock_drills
  before insert or update on public.drills
  for each row execute function public.content_rights_fa_lock_drills();

create trigger content_rights_fa_lock_sessions
  before insert or update on public.sessions
  for each row execute function public.content_rights_fa_lock_sessions();

create trigger content_rights_fa_lock_programmes
  before insert or update on public.programmes
  for each row execute function public.content_rights_fa_lock_programmes();

create trigger content_rights_fa_lock_templates
  before insert or update on public.templates
  for each row execute function public.content_rights_fa_lock_templates();

create trigger content_rights_fa_lock_media
  before insert or update on public.media
  for each row execute function public.content_rights_fa_lock_media();

-- ---------------------------------------------------------------------
-- PART 5: self verification
-- ---------------------------------------------------------------------
--
-- The triggers hold the invariant from here on. This proves it already
-- holds, so the migration cannot succeed against data the guard would have
-- refused, and that the five triggers are installed and the two helpers are
-- still callable by the role that has to evaluate them.

do $$
declare
  v_bad integer;
  v_triggers integer;
begin
  select count(*) into v_bad from (
    select 1 from public.drills
      where rights <> 'internal_only'
        and public.content_rights_fa_evidence(source_url, source_key, source_label)
    union all
    select 1 from public.sessions
      where rights <> 'internal_only'
        and public.content_rights_fa_evidence(source_url, null, source_label)
    union all
    select 1 from public.programmes
      where rights <> 'internal_only'
        and public.content_rights_fa_evidence(source_url, null, source_label)
    union all
    select 1 from public.templates
      where rights <> 'internal_only'
        and public.content_rights_fa_evidence(source_url, null, source_label)
    union all
    select 1 from public.media
      where rights <> 'internal_only'
        and public.content_rights_fa_evidence(source_url, null, source_label)
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

  -- The two helpers must stay executable by the writing roles, or every
  -- content write becomes a permission denied error instead of a clean
  -- refusal. Asserted rather than assumed.
  if not has_function_privilege('authenticated', 'public.content_rights_fa_evidence(text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.content_rights_fa_assert(public.content_rights, boolean, boolean, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.content_rights_is_fa_url(text)', 'execute')
  then
    raise exception '0043 self verification failed: the lock helpers are not executable by authenticated';
  end if;

  -- The corrected host rule, pinned both ways so a future edit cannot quietly
  -- widen or narrow it.
  if not public.content_rights_is_fa_url('https://x@learn.englandfootball.com/a')
     or not public.content_rights_is_fa_url('https://learn.englandfootball.com:443/a')
     or not public.content_rights_is_fa_url('  https://cdn.englandfootball.com/a  ')
     or not public.content_rights_is_fa_url(E'https:\\learn.englandfootball.com\\a')
     or not public.content_rights_is_fa_url('https:/learn.englandfootball.com/a')
     or not public.content_rights_is_fa_url('https:learn.englandfootball.com/a')
     or not public.content_rights_is_fa_url('https://%6cearn.englandfootball.com/a')
     or not public.content_rights_is_fa_url('https://learn%2Eenglandfootball.com/a')
     or public.content_rights_is_fa_url('https://learn.englandfootball.com:8080@evil.test/')
     or public.content_rights_is_fa_url('https://learn.englandfootball.com.evil.test/a')
     or public.content_rights_is_fa_url('https://notenglandfootball.com/a')
     or public.content_rights_is_fa_url('learn.englandfootball.com/a')
     or public.content_rights_is_fa_url('https://learn.englandfootball.com%40evil.test/')
     or public.content_rights_is_fa_url(null)
  then
    raise exception '0043 self verification failed: the England Football host rule does not match the URL parser';
  end if;
end $$;

commit;
