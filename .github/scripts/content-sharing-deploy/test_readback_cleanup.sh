#!/usr/bin/env bash
# Tests for readback_cleanup.sh (cleanup_workdir) and the readback integrity
# contract. Runs offline with bash and coreutils only:
#
#     bash .github/scripts/content-sharing-deploy/test_readback_cleanup.sh
#
# Verifies that cleanup succeeds for read-only and (where sudo is available)
# root-owned files, that an unsafe or empty path is rejected, that cleanup can
# never fail the job for a validated temp path, and that a source mismatch is
# still reported as REVIEW and not obscured by cleanup.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=.github/scripts/content-sharing-deploy/readback_cleanup.sh
source "$here/readback_cleanup.sh"

pass=0
fail=0
ok()   { echo "ok   - $1"; pass=$((pass + 1)); }
bad()  { echo "FAIL - $1"; fail=$((fail + 1)); }

# 1. Read-only files are removed and the helper returns 0.
d="$(mktemp -d)"
mkdir -p "$d/sub"
echo x > "$d/sub/ro.txt"
chmod -R a-w "$d"
if cleanup_workdir "$d" && [ ! -e "$d" ]; then
  ok "removes a tree containing read-only files"
else
  bad "read-only tree not removed (exit=$?, exists=$([ -e "$d" ] && echo yes || echo no))"
fi

# 2. Root-owned files: only meaningful where passwordless sudo exists.
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  d="$(mktemp -d)"
  sudo mkdir -p "$d/rootsub"
  echo x | sudo tee "$d/rootsub/root.txt" >/dev/null
  sudo chown -R 0:0 "$d/rootsub"
  if cleanup_workdir "$d" && [ ! -e "$d" ]; then
    ok "removes a tree containing root-owned files via sudo"
  else
    bad "root-owned tree not removed"
  fi
else
  echo "skip - root-owned case (no passwordless sudo on this host)"
fi

# 3. Empty path is a safe no-op (returns 0, deletes nothing).
if cleanup_workdir "" ; then
  ok "empty path is a no-op"
else
  bad "empty path should return 0"
fi

# 4. A path outside the temp root is refused (non-zero, nothing removed).
guard="$(mktemp -d)/repo-like"
mkdir -p "$guard"
# Point the temp root elsewhere so $guard is 'outside' it, and clear /tmp
# fallback by using a non-/tmp base.
outside="$HOME/.cleanup-guard-$$"
mkdir -p "$outside/keep"
echo keep > "$outside/keep/file"
if cleanup_workdir "$outside" ; then
  bad "path outside temp root should be refused"
else
  if [ -e "$outside/keep/file" ]; then
    ok "refuses and preserves a path outside the temp root"
  else
    bad "refused path was still deleted"
  fi
fi
rm -rf "$outside" 2>/dev/null || true
rm -rf "$(dirname "$guard")" 2>/dev/null || true

# 5. A non-absolute path is refused.
if cleanup_workdir "relative/dir" ; then
  bad "non-absolute path should be refused"
else
  ok "refuses a non-absolute path"
fi

# 6. A workspace path is refused even if it sits under /tmp.
export GITHUB_WORKSPACE="$(mktemp -d)"
mkdir -p "$GITHUB_WORKSPACE/src"
echo code > "$GITHUB_WORKSPACE/src/file"
if cleanup_workdir "$GITHUB_WORKSPACE" ; then
  bad "workspace path should be refused"
else
  if [ -e "$GITHUB_WORKSPACE/src/file" ]; then
    ok "refuses a GITHUB_WORKSPACE path"
  else
    bad "workspace path was deleted"
  fi
fi
rm -rf "$GITHUB_WORKSPACE" 2>/dev/null || true
unset GITHUB_WORKSPACE

# 7. Cleanup-cannot-obscure-readback: model the workflow control flow. Even if
#    the comparison yields REVIEW and cleanup runs, the REVIEW result stands and
#    the sequence exits 0 under set -e.
(
  set -e
  workdir="$(mktemp -d)"
  trap 'cleanup_workdir "$workdir"' EXIT
  level="REVIEW: downloaded index.ts differs from repo"
  chmod -R a-w "$workdir" 2>/dev/null || true
  cleanup_workdir "$workdir"
  trap - EXIT
  case "$level" in
    REVIEW:*) exit 0 ;;
    *) exit 3 ;;
  esac
)
if [ $? -eq 0 ]; then
  ok "REVIEW result survives cleanup and cleanup does not fail the job"
else
  bad "cleanup obscured the readback result or failed the job"
fi

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
