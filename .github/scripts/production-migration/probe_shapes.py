#!/usr/bin/env python3
"""The canonical object probe shapes, one per object kind, in both forms.

WHY THIS FILE EXISTS

Two things have to be proved about the probe totality guard and they are
normally proved in two different places, in two different languages, against
two different strings:

  * the guard ACCEPTS the absence-safe shape and REFUSES the eager textual one,
    which test_reviewed_migrations.py proves offline; and
  * the absence-safe shape really does answer false for an absent object while
    the eager textual one really does raise, which test_probe_totality.sh
    proves against a real PostgreSQL.

If those two sets of strings are typed separately they drift, and the day they
drift is the day the offline test proves something about a shape nobody runs.
So the strings live here once. `safe` and `unsafe` are rendered from the same
fields, which is what makes the unsafe form exactly the safe form with the
resolution taken out rather than a separately invented mistake.

This module touches no database, reads no secret and is not part of the apply.
It is test material and the verifier does not import it.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ProbeShape:
    """One object kind, and how a probe of it is written correctly and wrongly."""

    # The object kind, as the roadmap names it.
    kind: str
    # The catalog relation the resolved oid is read back out of, with its alias.
    catalog: str
    # That alias's oid column.
    oid: str
    # The absence-safe lookup for this kind. Returns null rather than raising.
    resolver: str
    # The reviewed object's name, exactly as it is written inside the resolver.
    name: str
    # The privilege inquiry function, and the privilege it is asked about.
    privilege: str
    access: str
    # A further narrowing on the catalog row, where the oid alone is not the
    # whole claim. A sequence and a table are both pg_class rows.
    extra: str = ""

    @property
    def safe(self) -> str:
        """Resolve the name once, then read the privilege off the row it found.

        An absent object makes the resolver null, `oid = null` matches nothing,
        and the count is 0, so the probe is FALSE rather than an error.
        """
        narrowing = f" and {self.extra}" if self.extra else ""
        return (
            f"(select count(*) > 0 from {self.catalog} "
            f"where {self.oid} = {self.resolver}('{self.name}'){narrowing} "
            f"and {self.privilege}('authenticated', {self.oid}, '{self.access}'))"
        )

    @property
    def unsafe(self) -> str:
        """The same question with the resolution taken out.

        PostgreSQL resolves the textual name before doing anything else and
        raises when nothing matches, which is the NORMAL pre-apply state.
        """
        return (
            f"(select {self.privilege}"
            f"('authenticated', '{self.name}', '{self.access}'))"
        )


# One per protected class. The names are deliberately unlike anything in the
# repository's schema: the harness creates and drops them on a throwaway server.
SHAPES: tuple[ProbeShape, ...] = (
    ProbeShape(
        kind="function",
        catalog="pg_proc p",
        oid="p.oid",
        resolver="to_regprocedure",
        name="public.otj_probe_fn(uuid)",
        privilege="has_function_privilege",
        access="EXECUTE",
    ),
    ProbeShape(
        kind="table",
        catalog="pg_class c",
        oid="c.oid",
        resolver="to_regclass",
        name="public.otj_probe_table",
        privilege="has_table_privilege",
        access="SELECT",
        # A sequence and a table are both pg_class rows, so the oid alone does
        # not say which one was found.
        extra="c.relkind = 'r'",
    ),
    ProbeShape(
        kind="schema",
        catalog="pg_namespace n",
        oid="n.oid",
        resolver="to_regnamespace",
        name="otj_probe_schema",
        privilege="has_schema_privilege",
        access="USAGE",
    ),
    ProbeShape(
        kind="sequence",
        catalog="pg_class c",
        oid="c.oid",
        resolver="to_regclass",
        name="public.otj_probe_seq",
        privilege="has_sequence_privilege",
        access="USAGE",
        extra="c.relkind = 'S'",
    ),
)

BY_KIND: dict[str, ProbeShape] = {shape.kind: shape for shape in SHAPES}


def main() -> int:
    """Print the shapes as JSON, for the shell harness to read."""
    import json
    import sys

    which = sys.argv[1] if len(sys.argv) > 1 else "safe"
    if which not in ("safe", "unsafe"):
        raise SystemExit("FAIL: ask for 'safe' or 'unsafe'")
    json.dump(
        {shape.kind: getattr(shape, which) for shape in SHAPES},
        sys.stdout,
        indent=2,
        sort_keys=True,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
