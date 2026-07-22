# shellcheck shell=bash
# Cleanup helper for the deployed-source readback step.
#
# `supabase functions download` can create files under the temporary work
# directory owned by root (or otherwise not removable by the GitHub runner
# user). A plain `rm -rf` on such a tree returns non-zero, and under
# `set -euo pipefail` that non-zero exit fails the whole deploy job even though
# the deploy itself succeeded. This helper removes the directory reliably
# without ever letting cleanup be the reason the workflow exits, and refuses to
# run a privileged removal against anything outside the temporary root.
#
# Source this file and call cleanup_workdir "$dir".

# Remove a temporary work directory created by mktemp -d, tolerating files the
# runner user cannot unlink directly. Returns non-zero ONLY when the path fails
# the safety guard; a failed removal of a validated temp path never returns
# non-zero, so a trap using this helper cannot fail the job.
cleanup_workdir() {
  local dir="${1:-}"

  # Empty path is a no-op. Never expand to a wildcard or a bare root.
  if [ -z "$dir" ]; then
    return 0
  fi

  # Must be an absolute path.
  case "$dir" in
    /*) : ;;
    *)
      echo "cleanup: refusing to remove a non-absolute path: '$dir'" >&2
      return 1
      ;;
  esac

  # Must live under the temporary root that mktemp -d used. This is the core
  # guard: a privileged removal is only ever allowed under /tmp or $TMPDIR.
  local tmproot="${TMPDIR:-/tmp}"
  tmproot="${tmproot%/}"
  case "$dir" in
    "$tmproot"/?*) : ;;
    /tmp/?*) : ;;
    *)
      echo "cleanup: refusing to remove a path outside the temporary root: '$dir'" >&2
      return 1
      ;;
  esac

  # Never touch the checked-out repository, even if it somehow sat under /tmp.
  if [ -n "${GITHUB_WORKSPACE:-}" ]; then
    case "$dir" in
      "$GITHUB_WORKSPACE" | "$GITHUB_WORKSPACE"/*)
        echo "cleanup: refusing to remove a workspace path: '$dir'" >&2
        return 1
        ;;
    esac
  fi

  # Nothing there already: done.
  if [ ! -e "$dir" ]; then
    return 0
  fi

  # First try as the runner user after restoring owner write/traverse bits on
  # everything we own. This clears the common read-only-file case.
  chmod -R u+rwX "$dir" 2>/dev/null || true
  if rm -rf "$dir" 2>/dev/null && [ ! -e "$dir" ]; then
    return 0
  fi

  # Files created by the download may be root-owned. On GitHub-hosted runners
  # the runner user has passwordless sudo; use it, scoped to the validated
  # temporary path only. -n so a runner without sudo fails fast instead of
  # hanging on a password prompt.
  if command -v sudo >/dev/null 2>&1; then
    sudo -n rm -rf "$dir" 2>/dev/null || true
  fi

  if [ -e "$dir" ]; then
    # Could not fully remove it. Report, but do NOT fail the job over cleanup.
    echo "cleanup: could not fully remove '$dir'; leaving it for the ephemeral runner to reclaim" >&2
  fi
  return 0
}
