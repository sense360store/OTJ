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

# Build a scratch tree shaped like a real download, with the function sources
# in directories the current user cannot unlink from. Where the tests run as a
# normal user (the GitHub runner, and any developer machine) a directory
# without the owner write bit reproduces EACCES exactly as a foreign owner
# does: rm needs write permission on the PARENT, and has it in neither case.
make_undeletable_download() {
  local d
  d="$(mktemp -d)"
  mkdir -p "$d/supabase/functions/spond-link-members" \
           "$d/supabase/functions/_shared" \
           "$d/supabase/.temp"
  echo 'export default 1' > "$d/supabase/functions/spond-link-members/index.ts"
  echo 'export const fa = 1'    > "$d/supabase/functions/_shared/fa.ts"
  echo 'export const spond = 1' > "$d/supabase/functions/_shared/spond.ts"
  echo 'cli' > "$d/supabase/.temp/cli-latest"
  chmod a-w "$d/supabase/functions/spond-link-members" "$d/supabase/functions/_shared"
  printf '%s' "$d"
}

# 8. The simulation reproduces the defect: a plain `rm -rf` returns non-zero.
#    root bypasses these permission checks entirely, so there the case is
#    reported as skipped rather than silently passing on a removal that only
#    succeeded because nothing was actually denied.
sim="$(make_undeletable_download)"
if [ "$(id -u)" = "0" ]; then
  echo "skip - plain rm -rf failure (running as root, which bypasses the permission check)"
  chmod -R u+rwX "$sim" 2>/dev/null || true
  rm -rf "$sim" 2>/dev/null || true
else
  if rm -rf "$sim" 2>/dev/null; then
    bad "simulated download tree was removable; the regression is not being reproduced"
    rm -rf "$sim" 2>/dev/null || true
  else
    ok "a plain rm -rf on the simulated download tree fails, as it did in run 31897367086"
    cleanup_workdir "$sim"
  fi
fi

# 9. The step's real control flow: substantive work succeeds, cleanup cannot
#    remove the tree the ordinary way, and the step still exits 0. Run with the
#    workflow's own `set -euo pipefail` and the workflow's own trap idiom.
(
  set -euo pipefail
  DL_DIR="$(make_undeletable_download)"
  trap 'cleanup_workdir "$DL_DIR" || true' EXIT
  # Stands in for the readback comparison: it reports NOT BYTE-FOR-BYTE
  # CONFIRMED and exits 0, exactly as the real step did.
  echo "NOT BYTE-FOR-BYTE CONFIRMED" >/dev/null
  exit 0
) >/dev/null 2>&1
if [ $? -eq 0 ]; then
  ok "readback step exits 0 when its substantive work succeeded, despite undeletable files"
else
  bad "cleanup turned a successful readback into a failed step (the run 31897367086 regression)"
fi

# 9b. The idiom being replaced really did fail, so case 9 is testing a fix and
#     not merely restating something that already worked. The tree is built out
#     here rather than inside the subshell, because the idiom under test is
#     precisely the one that cannot clean it up.
sim_old="$(make_undeletable_download)"
(
  set -euo pipefail
  DL_DIR="$sim_old"
  trap 'rm -rf "$DL_DIR"' EXIT
  exit 0
) >/dev/null 2>&1
old_status=$?
cleanup_workdir "$sim_old"
if [ "$(id -u)" = "0" ]; then
  echo "skip - old idiom failure (running as root, which bypasses the permission check)"
elif [ "$old_status" -ne 0 ]; then
  ok "the replaced idiom (trap 'rm -rf') did fail the step, so the fix is load bearing"
else
  bad "the replaced idiom did not fail; the regression is not being reproduced"
fi

# 10. A substantive failure BEFORE cleanup still exits non-zero. This is the
#     other half of the contract: a succeeding EXIT trap preserves the status
#     the shell is exiting with, so `|| true` on the cleanup call cannot mask a
#     real failure. Without this, the fix would trade a false red for a false
#     green, which is far worse.
(
  set -euo pipefail
  DL_DIR="$(make_undeletable_download)"
  trap 'cleanup_workdir "$DL_DIR" || true' EXIT
  exit 7
) >/dev/null 2>&1
if [ $? -eq 7 ]; then
  ok "a substantive failure before cleanup still exits non-zero, with its own status"
else
  bad "cleanup masked a real failure; the step must stay red when its work fails"
fi

# 11. The workflow still says what it was reviewed as saying. A tripwire, not a
#     proof: it reads the YAML as text and catches the realistic mistakes, a
#     bare rm -rf trap coming back, the helper no longer being sourced, or the
#     cleanup change having drifted into the deploy or security assertions.
wf="$here/../../workflows/deploy-spond-link-members.yml"
if [ ! -f "$wf" ]; then
  bad "deploy-spond-link-members.yml not found at $wf"
else
  # The cleanup fix is present.
  if grep -q 'trap .cleanup_workdir "\$DL_DIR" || true. EXIT' "$wf"; then
    ok "the readback trap goes through cleanup_workdir"
  else
    bad "the readback trap no longer goes through cleanup_workdir"
  fi
  # Sourcing the helper is the one new way this step could fail AFTER a
  # successful deploy, which is the failure class being fixed. So the path is
  # checked to resolve to a real file, not merely to be spelled the same way.
  src_line="$(grep -o 'source [^ ]*readback_cleanup\.sh' "$wf" | head -1)"
  if [ -n "$src_line" ]; then
    ok "the workflow sources the shared cleanup helper"
    if [ -f "$here/../../../${src_line#source }" ]; then
      ok "the sourced helper path resolves to a real file"
    else
      bad "the workflow sources a helper that does not exist: ${src_line#source }"
    fi
  else
    bad "the workflow no longer sources the shared cleanup helper"
  fi
  if grep -q "trap 'rm -rf" "$wf"; then
    bad "a bare 'trap rm -rf' has returned to the workflow"
  else
    ok "no bare 'trap rm -rf' remains in the workflow"
  fi

  # The deploy and security posture is untouched by that change. The deploy is
  # matched as a WHOLE LINE, so a flag appended to it fails this check rather
  # than passing a substring test.
  if grep -qE '^[[:space:]]*supabase functions deploy spond-link-members --project-ref "\$\{SUPABASE_PROJECT_ID\}"[[:space:]]*$' "$wf"; then
    ok "the deploy command is unchanged and carries no extra flags"
  else
    bad "the deploy command changed"
  fi
  # Comments are stripped first. This workflow's own comment says it passes no
  # --no-verify-jwt, and a plain substring test over the file reads that
  # sentence as the flag itself and fails a perfectly good workflow.
  if sed 's/#.*//' "$wf" | grep -q -- '--no-verify-jwt'; then
    bad "--no-verify-jwt appeared in executable text; the function must require a signed in caller"
  else
    ok "no --no-verify-jwt in executable text: the deployed JWT posture is unchanged"
  fi
  for needle in \
    "Assert the read only discovery posture, structurally" \
    "players\.manage" \
    "REFUSING TO DEPLOY" \
    "fn.get('verify_jwt') is not True" \
    "NOT BYTE-FOR-BYTE CONFIRMED"
  do
    if grep -q "$needle" "$wf"; then
      ok "still present: $needle"
    else
      bad "missing from the workflow: $needle"
    fi
  done
fi

echo "----"
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
