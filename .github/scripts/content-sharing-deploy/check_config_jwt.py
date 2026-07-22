#!/usr/bin/env python3
"""Validate the explicit JWT posture in supabase/config.toml.

Asserts, from version controlled config alone (no network):
  - [functions.manage-content-share] verify_jwt = true
  - [functions.read-content-share]   verify_jwt = false
  - read-content-share is the ONLY function anywhere in the file explicitly
    configured with verify_jwt = false.

This is the STAGE 2 invariant. It runs both locally (STAGE 11) and inside the
deploy workflow before any deploy. It prints only pass/fail facts, never a
secret (there are no secrets in config.toml).

Usage:
  check_config_jwt.py [path/to/config.toml]
Exit code 0 on success, 1 on any violation.
"""
from __future__ import annotations

import sys
import tomllib

MANAGE = "manage-content-share"
READ = "read-content-share"


def main(argv: list[str]) -> int:
    path = argv[1] if len(argv) > 1 else "supabase/config.toml"
    try:
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
    except FileNotFoundError:
        print(f"FAIL: config file not found: {path}")
        return 1
    except tomllib.TOMLDecodeError as exc:
        print(f"FAIL: config is not valid TOML: {exc}")
        return 1

    functions = data.get("functions", {})
    if not isinstance(functions, dict):
        print("FAIL: [functions.*] table is missing or malformed")
        return 1

    errors: list[str] = []

    # Explicit true for the management function.
    manage = functions.get(MANAGE)
    if not isinstance(manage, dict) or "verify_jwt" not in manage:
        errors.append(f"[functions.{MANAGE}] must explicitly set verify_jwt")
    elif manage.get("verify_jwt") is not True:
        errors.append(f"[functions.{MANAGE}].verify_jwt must be true, got {manage.get('verify_jwt')!r}")

    # Explicit false for the public reader.
    read = functions.get(READ)
    if not isinstance(read, dict) or "verify_jwt" not in read:
        errors.append(f"[functions.{READ}] must explicitly set verify_jwt")
    elif read.get("verify_jwt") is not False:
        errors.append(f"[functions.{READ}].verify_jwt must be false, got {read.get('verify_jwt')!r}")

    # read-content-share is the ONLY function explicitly set to verify_jwt=false.
    explicit_false = sorted(
        name
        for name, cfg in functions.items()
        if isinstance(cfg, dict) and cfg.get("verify_jwt") is False
    )
    if explicit_false != [READ]:
        errors.append(
            "exactly one function may be explicitly verify_jwt=false and it must be "
            f"{READ}; found: {explicit_false}"
        )

    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        return 1

    explicit_true = sorted(
        name
        for name, cfg in functions.items()
        if isinstance(cfg, dict) and cfg.get("verify_jwt") is True
    )
    print("PASS: config JWT posture is explicit and correct")
    print(f"  verify_jwt=true  (explicit): {explicit_true}")
    print(f"  verify_jwt=false (explicit): {explicit_false}")
    print(f"  {READ} is the only explicit anonymous function")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
