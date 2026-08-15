#!/usr/bin/env python3
"""Invariants for the gated Edge Function deploy workflows.

    python3 .github/scripts/deploy-workflows/test_workflow_invariants.py

Every workflow is read as DATA (yaml.safe_load) and never as a line of text,
so a broken run: block fails here rather than when a human dispatches a
production deploy. Assertions run against the EXECUTABLE half of each step's
body: shell comments are stripped first, because these workflows document
their own rules in prose and a sentence describing a rule must neither
satisfy a check nor trip one. That cuts both ways and both ways have already
bitten: a comment reading "No --no-verify-jwt" read as the flag itself, and a
trap commented out for debugging read as a trap that was still there.

The central rule is stated once, over every workflow, rather than pinned to
the one file that broke:

    a step that downloads into its own scratch directory must remove that
    directory through cleanup_workdir, never through a bare rm -rf.

`supabase functions download` extracts the eszip inside a container, so the
sources land owned by the container's user, and the runner cannot unlink a
file from a directory it does not own. A bare `rm -rf` in an EXIT trap then
returns non-zero, and a failing EXIT trap REPLACES the status the step was
exiting with, so a successful deploy is reported as a failed job. That is
GitHub Actions run 31897367086. A workflow added later that downloads into a
temp dir is covered by this rule automatically.
"""

import pathlib
import re
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / ".github" / "workflows"

failures: list[str] = []
checks = 0


def check(cond: object, msg: str) -> None:
    global checks
    checks += 1
    if not cond:
        failures.append(msg)


def strip_shell_comments(body: str) -> str:
    """Blank `#` comments, keeping quoted text and preserving line structure.

    A `#` only starts a comment at the start of a word, so `echo tag#1` and a
    `#` inside a quoted string both survive. Offsets are preserved so a line
    number stays meaningful and a stripped line never merges with the next.
    """
    out = []
    for line in body.split("\n"):
        res, i, n = [], 0, len(line)
        quote = None
        while i < n:
            c = line[i]
            if quote:
                if c == "\\" and quote != "'":
                    res.append(c)
                    if i + 1 < n:
                        res.append(line[i + 1])
                    i += 2
                    continue
                if c == quote:
                    quote = None
                res.append(c)
            elif c in ("'", '"'):
                quote = c
                res.append(c)
            elif c == "#" and (i == 0 or line[i - 1].isspace()):
                break  # comment runs to end of line
            else:
                res.append(c)
            i += 1
        out.append("".join(res))
    return "\n".join(out)


def steps_of(path: pathlib.Path) -> list[dict]:
    wf = yaml.safe_load(path.read_text(encoding="utf-8"))
    check(isinstance(wf, dict), f"{path.name}: does not parse to a mapping")
    jobs = wf.get("jobs") or {}
    check(bool(jobs), f"{path.name}: has no jobs")
    out = []
    for job in jobs.values():
        out += list(job.get("steps") or [])
    return out


deploy_workflows = sorted(WORKFLOWS.glob("deploy-*.yml"))
check(len(deploy_workflows) >= 4,
      f"expected at least four deploy workflows, found {len(deploy_workflows)}")

# A step that cds into a scratch directory and downloads there. The download
# writes relative to the working directory, so without the cd the files land
# in the checkout and the temp dir only ever holds what the shell put there.
DOWNLOADS_INTO_SCRATCH = re.compile(
    r"""cd\s+"\$(?:\{)?(\w+)\}?"\s*&&\s*supabase\s+functions\s+download""")
EXIT_TRAP = re.compile(r"""trap\s+(['"])(.+?)\1\s+EXIT""")

for path in deploy_workflows:
    for step in steps_of(path):
        body = step.get("run")
        if not body:
            continue
        name = f"{path.name} / {step.get('name', '<unnamed>')}"
        code = strip_shell_comments(body)

        # Every sourced helper must exist. Sourcing runs under set -e, so a
        # missing helper fails the step, and in a readback step that means
        # failing AFTER a successful production deploy: the exact class of
        # false red this rule exists to prevent.
        for rel in re.findall(r"^\s*(?:source|\.)\s+(\S+)", code, re.M):
            if rel.startswith("$"):
                continue
            check((ROOT / rel).is_file(),
                  f"{name}: sources a helper that does not exist: {rel}")

        scratch = DOWNLOADS_INTO_SCRATCH.search(code)
        if not scratch:
            continue
        var = scratch.group(1)
        traps = [t[1] for t in EXIT_TRAP.findall(code)]
        relevant = [t for t in traps if var in t]
        check(relevant,
              f"{name}: downloads into ${var} but sets no EXIT trap for it")
        for t in relevant:
            check("cleanup_workdir" in t,
                  f"{name}: cleans ${var} with a bare removal, not cleanup_workdir: {t!r}. "
                  "A failing EXIT trap replaces the step's exit status, so this "
                  "turns a successful deploy into a failed job (run 31897367086).")
            check(not re.search(r"\brm\s+-[a-z]*r", t),
                  f"{name}: a recursive rm remains in the EXIT trap: {t!r}")

# ---------------------------------------------------------------------------
# spond-link-members: the workflow this rule was written from. These pin that
# the cleanup change did not disturb the deploy or the security gate.
# ---------------------------------------------------------------------------
slm = WORKFLOWS / "deploy-spond-link-members.yml"
steps = steps_of(slm)
bodies = {s.get("name", ""): strip_shell_comments(s.get("run") or "")
          for s in steps if s.get("run")}
whole = "\n".join(bodies.values())

check(any(re.fullmatch(
        r'\s*supabase functions deploy spond-link-members --project-ref "\$\{SUPABASE_PROJECT_ID\}"\s*',
        line)
        for line in whole.split("\n")),
      "the spond-link-members deploy command changed or carries extra flags")

check("--no-verify-jwt" not in whole,
      "--no-verify-jwt appears in executable text; the function must require a signed in caller")

# Substring, not regex: these needles are themselves regex source in the
# workflow, so their backslashes are literal text to be found.
for needle in (r"rpc\(\s*'has_perm'", r"'players\.manage'", "REFUSING TO DEPLOY",
               "collectLinkCandidates", "SPOND_MEMBER_ID_PATTERN",
               "resolveCaller", "SERVICE_ROLE"):
    check(needle in whole,
          f"the structural security assertions no longer mention {needle!r}")

check("fn.get('verify_jwt') is not True" in whole,
      "the deployed JWT posture assertion is gone")
check("NOT BYTE-FOR-BYTE CONFIRMED" in whole,
      "the readback verdict wording is gone")

# The readback verdict stays reported and non fatal: the comparison ends by
# exiting 0 whatever it found, and only a real deploy or state failure is
# allowed to fail the job.
readback = next(v for k, v in bodies.items() if k.startswith("Read the deployed source back"))
check("sys.exit(0)" in readback,
      "the readback no longer exits 0 unconditionally; a differing bundle must stay non fatal")
check("cleanup_workdir" in readback, "the readback step no longer uses cleanup_workdir")

print(f"checked {checks} invariants across {len(deploy_workflows)} deploy workflows")
if failures:
    print("\nFAILED:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("all deploy workflow invariants hold")
