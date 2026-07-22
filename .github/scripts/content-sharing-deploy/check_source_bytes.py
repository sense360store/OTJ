#!/usr/bin/env python3
"""Hash the deploy source and refuse forbidden raw control bytes (STAGE 5).

For each file given on the command line:
  - read it as raw bytes;
  - reject any forbidden control byte. Allowed whitespace is tab (0x09),
    line feed (0x0A) and carriage return (0x0D). Everything in
    0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F and 0x7F is forbidden, so a raw control
    byte cannot hide in the TypeScript source;
  - record the SHA-256 hash.

For supabase/functions/_shared/share.ts specifically, additionally assert that
the CONTROL_CHARS regex line contains the literal textual escape sequence for a
null character (a backslash, a 'u', then four zero digits), proving the control
range is written as text escapes rather than raw bytes. If it were raw bytes,
the forbidden-byte scan above would already fail; this is belt and braces.

The file CONTENTS are never printed, only paths and hashes. A markdown table is
appended to GITHUB_STEP_SUMMARY when that environment variable is set.

Usage:
  check_source_bytes.py <file> [<file> ...]
Exit 0 if every file is clean, 1 otherwise.
"""
from __future__ import annotations

import hashlib
import os
import sys

# Allowed whitespace control bytes.
ALLOWED = {0x09, 0x0A, 0x0D}
FORBIDDEN = (
    set(range(0x00, 0x09)) | {0x0B, 0x0C} | set(range(0x0E, 0x20)) | {0x7F}
) - ALLOWED

CONTROL_CHARS_MARKER = b"CONTROL_CHARS"
# The literal bytes: backslash, 'u', '0', '0', '0', '0'.
TEXTUAL_ESCAPE = bytes([0x5C, 0x75, 0x30, 0x30, 0x30, 0x30])


def forbidden_positions(data: bytes) -> list[int]:
    return [i for i, b in enumerate(data) if b in FORBIDDEN]


def check_control_chars_line(path: str, data: bytes) -> str | None:
    """Return an error string, or None if the CONTROL_CHARS line is textual."""
    for line in data.split(b"\n"):
        if CONTROL_CHARS_MARKER in line and b"=" in line:
            if TEXTUAL_ESCAPE in line:
                return None
            return (
                f"{path}: CONTROL_CHARS line lacks the expected literal "
                "backslash-u escape text (possible raw control bytes)"
            )
    return f"{path}: no CONTROL_CHARS definition found"


def main(argv: list[str]) -> int:
    files = argv[1:]
    if not files:
        print("FAIL: no files given")
        return 1

    errors: list[str] = []
    rows: list[tuple[str, str]] = []

    for path in files:
        try:
            with open(path, "rb") as fh:
                data = fh.read()
        except FileNotFoundError:
            errors.append(f"{path}: file not found")
            continue

        bad = forbidden_positions(data)
        if bad:
            # Report only offsets and byte values, never surrounding content.
            sample = ", ".join(f"offset {i} (0x{data[i]:02x})" for i in bad[:8])
            errors.append(f"{path}: forbidden raw control byte(s): {sample}")

        if os.path.basename(path) == "share.ts":
            cc_err = check_control_chars_line(path, data)
            if cc_err:
                errors.append(cc_err)

        digest = hashlib.sha256(data).hexdigest()
        rows.append((path, digest))

    for path, digest in rows:
        print(f"sha256  {digest}  {path}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as sfh:
            sfh.write("\n### Deploy source hashes (SHA-256)\n\n")
            sfh.write("| File | SHA-256 |\n|---|---|\n")
            for path, digest in rows:
                sfh.write(f"| `{path}` | `{digest}` |\n")
            sfh.write("\n")

    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        return 1

    print(f"PASS: {len(rows)} source file(s) clean, no forbidden control bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
