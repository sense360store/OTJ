#!/usr/bin/env python3
"""Print a captured psql log with the connection string removed.

The apply step runs psql with the full Postgres URI, which carries the database
password. libpq's own connection failures name the host, and a future psql
build could echo more, so nothing psql writes reaches the job log unfiltered.

Reads SUPABASE_DB_URL from the environment, replaces the whole URI, its
password and its user wherever they appear, and prints the result. If the
variable is unset the log is still filtered of nothing and printed, because a
missing variable means there was no secret in the environment to leak.

Usage:
  redact.py <logfile>
"""
from __future__ import annotations

import os
import sys
import urllib.parse

DB_URL_ENV = "SUPABASE_DB_URL"


def redact(text: str, db_url: str) -> str:
    if not text:
        return ""
    if not db_url:
        return text
    out = text.replace(db_url, "[redacted]")
    try:
        parsed = urllib.parse.urlsplit(db_url)
        if parsed.password:
            out = out.replace(parsed.password, "[redacted]")
            # A URI carries the password percent-encoded; the message that
            # quotes it back may not, or the reverse, so both forms go.
            out = out.replace(urllib.parse.unquote(parsed.password), "[redacted]")
        if parsed.username:
            out = out.replace(parsed.username, "[redacted]")
    except ValueError:
        pass
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("FAIL: usage: redact.py <logfile>")
        return 1
    try:
        with open(argv[1], "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except FileNotFoundError:
        print(f"FAIL: log file not found: {argv[1]}")
        return 1
    sys.stdout.write(redact(text, os.environ.get(DB_URL_ENV, "")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
