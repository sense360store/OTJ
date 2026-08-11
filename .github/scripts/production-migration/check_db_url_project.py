#!/usr/bin/env python3
"""Confirm the connection string points at the expected Supabase project.

WHY THIS EXISTS

Every other gate in the workflow guards a DIFFERENT value from the one the
apply actually connects through. The typed ref is checked against a hardcoded
ref and against SUPABASE_PROJECT_ID, and the access token is checked by asking
the CLI which projects it can see. None of that constrains SUPABASE_DB_URL,
which is a separate secret and is the only thing psql uses. A
SUPABASE_DB_URL pointing at another Supabase project would sail past all of
them.

Supabase connection strings carry the project ref as a component:

  session pooler   postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
  direct           postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres

So the ref is asserted as a dotted COMPONENT of the user or the host, never as
a loose substring: a project whose ref merely contains another's would not pass
by accident.

The URL is never printed. On failure this says which parts were inspected in
the abstract and nothing about their values.

Usage:
  check_db_url_project.py            # reads SUPABASE_DB_URL and EXPECTED_PROJECT_REF
"""
from __future__ import annotations

import os
import sys
import urllib.parse

DB_URL_ENV = "SUPABASE_DB_URL"
REF_ENV = "EXPECTED_PROJECT_REF"


def components(db_url: str) -> tuple[list[str], list[str]]:
    """The dotted parts of the URL's user and host.

    Raises ValueError when the URL cannot be parsed or carries no host, so an
    unreadable connection string fails closed rather than being waved through.
    """
    parsed = urllib.parse.urlsplit(db_url)
    if not parsed.scheme.startswith("postgres"):
        raise ValueError("the connection string is not a postgres URI")
    host = parsed.hostname
    if not host:
        raise ValueError("the connection string carries no host")
    user = parsed.username or ""
    return [p for p in user.split(".") if p], [p for p in host.split(".") if p]


def targets_project(db_url: str, ref: str) -> tuple[bool, str]:
    """Does this connection string address the given project ref?"""
    user_parts, host_parts = components(db_url)
    if ref in user_parts:
        return True, "the connection user"
    if ref in host_parts:
        return True, "the connection host"
    return False, ""


def main(argv: list[str]) -> int:
    db_url = os.environ.get(DB_URL_ENV, "")
    ref = os.environ.get(REF_ENV, "")
    if not db_url:
        print(f"FAIL: {DB_URL_ENV} is not set")
        return 1
    if not ref:
        print(f"FAIL: {REF_ENV} is not set")
        return 1
    try:
        matched, where = targets_project(db_url, ref)
    except ValueError as exc:
        print(f"FAIL: {DB_URL_ENV} could not be read as a Postgres connection string ({exc})")
        return 1
    if not matched:
        print(
            f"FAIL: {DB_URL_ENV} does not address project {ref}. Neither the "
            "connection user nor the connection host names it. Refusing to "
            "apply a migration through a connection to an unverified project."
        )
        return 1
    print(f"{DB_URL_ENV} addresses {ref} (named in {where})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
