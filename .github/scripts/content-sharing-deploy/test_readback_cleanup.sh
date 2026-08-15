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

# ---------------------------------------------------------------------------
# The spond-link-members readback step. Its scratch directory is the one place
# in the repo that `supabase functions download` writes INTO a temp dir rather
# than over the checkout, so it is the one place the container's user owns
# files the runner must later remove. Run 31897367086 deployed, verified the
# hosted state and printed its readback verdict, and then went red purely
# because the EXIT trap's `rm -rf` hit Permission denied on those files.
#
# Cases 8 to 10 model that step's control flow directly. Case 8 proves the
# simulation actually reproduces the defect, so 9 and 10 are not vacuous.
# ---------------------------------------------------------------------------

# Build a scratch tree shaped like a real download: the function sources under
# directories the current user cannot unlink from, and a .temp the user does
# own, which is the exact split run 31897367086 showed.
#
# FIDELITY. The real files are owned by the CONTAINER's user. Where sudo is
# available the simulation reproduces that ownership, which is what drives
# cleanup_workdir down its privileged fallback: its first act is
# `chmod -R u+rwX`, and that SUCCEEDS on a tree you own, so an owned but
# read-only tree exercises a different, easier branch. Without sudo the
# simulation falls back to removing the owner write bit, which still denies a
# plain rm (rm needs write permission on the PARENT) but is cleaned up without
# the fallback. $SIM_FIDELITY records which was achieved so no case can claim
# more than it tested.
SIM_FIDELITY="owner-readonly"
if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null && [ "$(id -u)" != "0" ]; then
  SIM_FIDELITY="foreign-owned"
fi

make_undeletable_download() {
  local d
  d="$(mktemp -d)"
  mkdir -p "$d/supabase/.temp"
  echo 'cli' > "$d/supabase/.temp/cli-latest"
  if [ "$SIM_FIDELITY" = "foreign-owned" ]; then
    # As the container does: the sources and the directories holding them
    # belong to another user, and the invoking user cannot chmod them either.
    sudo mkdir -p "$d/supabase/functions/spond-link-members" \
                  "$d/supabase/functions/_shared"
    echo 'export default 1'       | sudo tee "$d/supabase/functions/spond-link-members/index.ts" >/dev/null
    echo 'export const fa = 1'    | sudo tee "$d/supabase/functions/_shared/fa.ts" >/dev/null
    echo 'export const spond = 1' | sudo tee "$d/supabase/functions/_shared/spond.ts" >/dev/null
    sudo chown -R 0:0 "$d/supabase/functions"
  else
    mkdir -p "$d/supabase/functions/spond-link-members" \
             "$d/supabase/functions/_shared"
    echo 'export default 1'       > "$d/supabase/functions/spond-link-members/index.ts"
    echo 'export const fa = 1'    > "$d/supabase/functions/_shared/fa.ts"
    echo 'export const spond = 1' > "$d/supabase/functions/_shared/spond.ts"
    chmod a-w "$d/supabase/functions/spond-link-members" "$d/supabase/functions/_shared"
  fi
  printf '%s' "$d"
}
echo "note - download simulation fidelity: $SIM_FIDELITY"

# Whether the simulation can actually deny a removal to THIS user. root
# bypasses every permission check, so there the tree is removable and any case
# resting on it would pass without testing anything. Such cases announce
# themselves as skipped rather than reporting a green they did not earn.
SIM_DENIES=yes
[ "$(id -u)" = "0" ] && SIM_DENIES=no

# 8. The simulation reproduces the defect: a plain `rm -rf` returns non-zero.
sim="$(make_undeletable_download)"
if [ "$SIM_DENIES" = "no" ]; then
  echo "skip - plain rm -rf failure (running as root, which bypasses the permission check)"
  cleanup_workdir "$sim"
elif rm -rf "$sim" 2>/dev/null; then
  bad "simulated download tree was removable; the regression is not being reproduced"
  cleanup_workdir "$sim"
else
  ok "a plain rm -rf on the simulated download tree fails, as it did in run 31897367086"
  cleanup_workdir "$sim"
fi

# 9. The step's real control flow: substantive work succeeds, cleanup cannot
#    remove the tree the ordinary way, and the step still exits 0. Run under
#    the workflow's own `set -euo pipefail` and its own trap idiom.
run_readback_step() {  # $1 = trap body, $2 = status the step body exits with
  local dir; dir="$(make_undeletable_download)"
  (
    set -euo pipefail
    DL_DIR="$dir"
    trap "$1" EXIT
    exit "$2"
  ) >/dev/null 2>&1
  local st=$?
  cleanup_workdir "$dir"
  return "$st"
}

if [ "$SIM_DENIES" = "no" ]; then
  echo "skip - readback step exit status over an undeletable tree (running as root)"
  echo "skip - the replaced idiom's failure (running as root)"
else
  run_readback_step 'cleanup_workdir "$DL_DIR" || true' 0
  if [ $? -eq 0 ]; then
    ok "readback step exits 0 when its substantive work succeeded, despite undeletable files"
  else
    bad "cleanup turned a successful readback into a failed step (the run 31897367086 regression)"
  fi

  # 9b. The idiom being replaced really did fail, so case 9 is testing a fix
  #     and not restating something that already worked.
  run_readback_step 'rm -rf "$DL_DIR"' 0
  if [ $? -ne 0 ]; then
    ok "the replaced idiom (trap 'rm -rf') did fail the step, so the fix is load bearing"
  else
    bad "the replaced idiom did not fail; the regression is not being reproduced"
  fi
fi

# 10. A substantive failure BEFORE cleanup still exits non-zero, with its own
#     status. This is the other half of the contract: a SUCCEEDING exit trap
#     preserves the status the shell is exiting with, so `|| true` on the
#     cleanup call cannot mask a real failure. Without this the fix would trade
#     a false red for a false green, which is worse. This holds whatever the
#     simulation fidelity, so it never skips.
run_readback_step 'cleanup_workdir "$DL_DIR" || true' 7
if [ $? -eq 7 ]; then
  ok "a substantive failure before cleanup still exits non-zero, with its own status"
else
  bad "cleanup masked a real failure; the step must stay red when its work fails"
fi

# The workflow's own invariants (the trap, the sourced helper, the deploy line,
# the security assertions) are NOT checked here. They live in
# .github/scripts/deploy-workflows/test_workflow_invariants.py, which parses
# the YAML and reads the executable half of each step. A grep over raw YAML
# reported green on a trap that had merely been commented out, which is the
# reason that check moved rather than being repaired in place.

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
