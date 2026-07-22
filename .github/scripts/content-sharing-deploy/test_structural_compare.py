#!/usr/bin/env python3
"""Tests for structural_compare.py.

Runs offline with the standard library only:

    python3 .github/scripts/content-sharing-deploy/test_structural_compare.py

Confirms that a source mismatch is reported structurally (sizes + both hashes +
set differences), that identical files are reported as matching, and that no
full source line or secret value reaches the output.
"""
from __future__ import annotations

import contextlib
import io
import os
import tempfile
import unittest

import structural_compare as sc

SECRET = "super-secret-bearer-token-DO-NOT-PRINT"

REPO_SRC = f"""
import {{ corsHeaders, reply }} from '../_shared/fa.ts'
import {{ createClient }} from 'npm:@supabase/supabase-js@2'
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const AUTH = 'Bearer {SECRET}'
const CONTROL_CHARS = /[\\x00-\\x1f]/g
await db.rpc('has_perm', {{ capability }})
export const config = {{ verify_jwt: true }}
"""

# Same shape but with an extra import and env name, to force a structural diff.
DL_SRC = f"""
import {{ corsHeaders, reply }} from '../_shared/fa.ts'
import {{ createClient }} from 'npm:@supabase/supabase-js@2'
import {{ extra }} from '../_shared/other.ts'
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const URL = Deno.env.get('SUPABASE_URL') ?? ''
const AUTH = 'Bearer {SECRET}'
await db.rpc('has_perm', {{ capability }})
"""


def write(text: str) -> str:
    fd, path = tempfile.mkstemp(suffix=".ts")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


def run(repo: str, dl: str, label: str = "manage-content-share/index.ts") -> str:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        sc.main(["structural_compare.py", "--repo", repo, "--download", dl, "--label", label])
    return buf.getvalue()


class TestStructuralCompare(unittest.TestCase):
    def test_identical_files_report_match(self):
        p = write(REPO_SRC)
        try:
            out = run(p, p)
        finally:
            os.remove(p)
        self.assertIn("identical (SHA-256 match)", out)

    def test_mismatch_reports_sizes_and_both_hashes(self):
        r, d = write(REPO_SRC), write(DL_SRC)
        try:
            out = run(r, d)
        finally:
            os.remove(r)
            os.remove(d)
        self.assertIn("bytes: DIFFER", out)
        self.assertIn("bytes, sha256", out)
        # Both distinct hashes present.
        self.assertEqual(out.count("sha256 `"), 2)
        # Structural differences surfaced.
        self.assertIn("only in download", out)
        self.assertIn("../_shared/other.ts", out)
        self.assertIn("SUPABASE_URL", out)

    def test_no_secret_or_full_source_in_output(self):
        r, d = write(REPO_SRC), write(DL_SRC)
        try:
            out = run(r, d)
        finally:
            os.remove(r)
            os.remove(d)
        self.assertNotIn(SECRET, out)
        self.assertNotIn("Bearer", out)
        # No full source line leaks: the Authorization assignment never appears.
        self.assertNotIn("const AUTH", out)

    def test_missing_download_is_not_fatal(self):
        r = write(REPO_SRC)
        try:
            out = run(r, "/nonexistent/path/index.ts")
        finally:
            os.remove(r)
        self.assertIn("not present", out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
