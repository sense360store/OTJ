-- =====================================================================
-- Apply ONE reviewed migration and record it in the hosted ledger, in ONE
-- transaction.
--
-- Run by .github/workflows/apply-production-migration.yml only, through psql,
-- with these variables set on the command line:
--
--   ledger_name     supabase_migrations.schema_migrations.name  ("drill_diagram")
--   ledger_key      its UNIQUE idempotency_key  ("otj:migration:0046_drill_diagram")
--   created_by      provenance, "github-actions:apply-production-migration@<sha>"
--   migration_sql   the migration file's text, recorded verbatim
--   migration_path  the repo-relative path psql reads the migration from
--
-- WHY THE INSERT COMES FIRST
--
-- The reviewed migration files are each one transaction: they open with BEGIN
-- and close with COMMIT (the workflow refuses to run one that does not). This
-- script opens a transaction, inserts the ledger row, and then reads the
-- migration in with \i. The migration's own BEGIN is a no-op inside the open
-- transaction, and its COMMIT is what commits BOTH the ledger row and the
-- schema change, together.
--
-- That ordering is the whole safety property. Any failure in the migration,
-- including its own self-verification DO blocks, aborts the transaction and
-- takes the ledger row with it, so the ledger can never claim a migration that
-- did not apply. And because the insert is attempted first, a role that cannot
-- write the ledger fails the run before a single DDL statement executes,
-- rather than leaving a schema change with no ledger row.
--
-- The trailing COMMIT below is a belt: after the migration's own COMMIT there
-- is no transaction open, so it warns and does nothing. It matters only if a
-- future migration file were to omit its own COMMIT, in which case it is what
-- commits the work.
--
-- WHY NOT `supabase db push`
--
-- This repository names its migration files 0001..0046 while the hosted ledger
-- records 14 digit timestamp versions assigned at apply time. `db push` would
-- reconcile the two by pushing every unapplied local file under its own file
-- name as the version, which both applies more than one migration and writes a
-- version shape the ledger has never used. This script applies exactly the one
-- file it is given and records it the way every existing hosted row is
-- recorded: one statements entry holding the whole file, a name, and a version
-- stamped from the database server clock.
-- =====================================================================

\set ON_ERROR_STOP on

begin;

-- The version is assigned here, by the database, from its own clock in UTC.
-- It is a 14 digit stamp, the same shape as every existing row, and it is the
-- primary key, so a collision with an existing row aborts this transaction
-- rather than overwriting anything.
--
-- idempotency_key is UNIQUE on this table. Recording a per migration key makes
-- a second apply of the same migration impossible at the database, not merely
-- unlikely: the duplicate key aborts the transaction before any DDL runs.
insert into supabase_migrations.schema_migrations
  (version, name, statements, created_by, idempotency_key)
values (
  to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'),
  :'ledger_name',
  array[:'migration_sql'],
  :'created_by',
  :'ledger_key'
);

-- The reviewed migration, byte for byte as it sits in the checked-out commit.
\i :migration_path

commit;
