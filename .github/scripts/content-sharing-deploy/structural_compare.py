#!/usr/bin/env python3
"""Bounded, secret-safe structural comparison of two TypeScript source files.

Used by the deployed-source readback step when a downloaded function file's
SHA-256 differs from the repository file. It reports *shape* differences only,
never full source: file sizes, both hashes, and set differences over a handful
of structural facts (import specifiers, verify_jwt mentions, environment
variable names, RPC names, and whether a CONTROL_CHARS literal is present).

It never prints:

- full source lines,
- Authorization headers or bearer tokens,
- the value of any environment variable (only the *names* referenced),
- secrets of any kind.

Usage:

    structural_compare.py --repo <repo.ts> --download <downloaded.ts> --label <name>

Exit code is always 0: a structural difference is a review signal for the
summary, not a workflow failure. Missing files are reported, not fatal.
"""
from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path

# Patterns extract only structural identifiers, never values. Each captures a
# bounded token (a module specifier, an env var name, an rpc name).
IMPORT_RE = re.compile(r"""from\s+['"]([^'"]+)['"]""")
ENV_RE = re.compile(r"""Deno\.env\.get\(\s*['"]([A-Z0-9_]+)['"]\s*\)""")
RPC_RE = re.compile(r"""\.rpc\(\s*['"]([A-Za-z0-9_]+)['"]""")
VERIFY_JWT_RE = re.compile(r"verify_jwt")
CONTROL_CHARS_RE = re.compile(r"CONTROL_CHARS")


def facts(text: str) -> dict:
    return {
        "imports": sorted(set(IMPORT_RE.findall(text))),
        "env_names": sorted(set(ENV_RE.findall(text))),
        "rpc_names": sorted(set(RPC_RE.findall(text))),
        "verify_jwt_mentions": len(VERIFY_JWT_RE.findall(text)),
        "has_control_chars": bool(CONTROL_CHARS_RE.search(text)),
    }


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def line(msg: str) -> None:
    print(msg)


def set_diff(name: str, repo_vals, dl_vals) -> None:
    repo_set, dl_set = set(repo_vals), set(dl_vals)
    only_repo = sorted(repo_set - dl_set)
    only_dl = sorted(dl_set - repo_set)
    if not only_repo and not only_dl:
        line(f"  - {name}: identical ({len(repo_set)} entries)")
        return
    if only_repo:
        line(f"  - {name}: only in repo: {only_repo}")
    if only_dl:
        line(f"  - {name}: only in download: {only_dl}")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--download", required=True)
    ap.add_argument("--label", required=True)
    args = ap.parse_args(argv[1:])

    repo_path, dl_path = Path(args.repo), Path(args.download)
    line(f"#### Structural comparison: `{args.label}`")

    if not repo_path.is_file():
        line(f"  - repository file not found: `{args.label}` (nothing to compare)")
        return 0
    if not dl_path.is_file():
        line(f"  - downloaded file not present: `{args.label}` (not in the bundle)")
        return 0

    repo_bytes = repo_path.read_bytes()
    dl_bytes = dl_path.read_bytes()
    repo_hash, dl_hash = sha256(repo_bytes), sha256(dl_bytes)

    line(f"  - repo:     {len(repo_bytes)} bytes, sha256 `{repo_hash}`")
    line(f"  - download: {len(dl_bytes)} bytes, sha256 `{dl_hash}`")

    if repo_hash == dl_hash:
        line("  - bytes: identical (SHA-256 match)")
        return 0

    line("  - bytes: DIFFER (structural comparison follows; full source not printed)")
    repo_facts = facts(repo_bytes.decode("utf-8", "replace"))
    dl_facts = facts(dl_bytes.decode("utf-8", "replace"))

    set_diff("imports", repo_facts["imports"], dl_facts["imports"])
    set_diff("env var names", repo_facts["env_names"], dl_facts["env_names"])
    set_diff("rpc names", repo_facts["rpc_names"], dl_facts["rpc_names"])

    if repo_facts["verify_jwt_mentions"] == dl_facts["verify_jwt_mentions"]:
        line(f"  - verify_jwt mentions: identical ({repo_facts['verify_jwt_mentions']})")
    else:
        line(
            f"  - verify_jwt mentions: repo {repo_facts['verify_jwt_mentions']}, "
            f"download {dl_facts['verify_jwt_mentions']}"
        )

    if repo_facts["has_control_chars"] == dl_facts["has_control_chars"]:
        line(f"  - CONTROL_CHARS literal present: {repo_facts['has_control_chars']} (both)")
    else:
        line(
            f"  - CONTROL_CHARS literal present: repo {repo_facts['has_control_chars']}, "
            f"download {dl_facts['has_control_chars']}"
        )
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv))
