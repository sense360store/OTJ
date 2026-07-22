#!/usr/bin/env python3
"""Confirm the authenticated account can see the intended project (STAGE 4).

Reads the JSON produced by `supabase projects list --output json` from a file
(written to a temp path by the workflow, then deleted), and confirms the
expected project ref is present. This proves the access token authenticates and
that the intended project is visible to it, WITHOUT ever printing the token or
dumping the raw file to the log.

The token is never read by this script; it is only in the CLI's environment.
This script sees only project metadata (refs, names) and prints a single
pass/fail line plus the matched ref.

Usage:
  validate_token.py <projects_list.json> [<expected_ref>]
Expected ref may also come from EXPECTED_PROJECT_REF. Exit 0 if visible.
"""
from __future__ import annotations

import json
import os
import sys


def project_refs(doc: object) -> set[str]:
    """Collect candidate project refs from a projects-list JSON document."""
    refs: set[str] = set()
    items = doc if isinstance(doc, list) else doc.get("projects", []) if isinstance(doc, dict) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        for key in ("ref", "id", "project_ref", "reference_id"):
            val = item.get(key)
            if isinstance(val, str) and val:
                refs.add(val)
    return refs


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("FAIL: usage: validate_token.py <projects_list.json> [<expected_ref>]")
        return 1
    path = argv[1]
    expected = argv[2] if len(argv) > 2 else os.environ.get("EXPECTED_PROJECT_REF", "")
    if not expected:
        print("FAIL: no expected project ref provided")
        return 1

    try:
        with open(path, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except FileNotFoundError:
        print(f"FAIL: projects list output not found: {path}")
        return 1
    except json.JSONDecodeError as exc:
        print(f"FAIL: could not parse projects list output as JSON: {exc}")
        return 1

    refs = project_refs(doc)
    if not refs:
        print("FAIL: authenticated account returned no visible projects")
        return 1

    if expected not in refs:
        # Do not print the full project list; just the count and the miss.
        print(f"FAIL: intended project {expected} is not visible to this token "
              f"({len(refs)} project(s) visible)")
        return 1

    print("PASS: Supabase authentication succeeded")
    print(f"  intended project is accessible: {expected}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
