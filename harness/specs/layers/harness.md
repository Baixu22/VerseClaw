---
id: harness
title: Harness Layer
type: layer-spec
pathPatterns:
  - AGENTS.md
  - harness/**
---

The harness is the Verse Claw-owned agent contract system. It stores scenarios, hard rules, task specs, guides, and layer specs in repo files that AI tools can reload.

Keep `AGENTS.md` lightweight. Put durable, reusable policy in `harness/specs/**`, and make hard constraints machine-checkable when practical.

For new harness behavior, add unit tests under `tests/unit/harness-*.test.ts` and keep CLI output deterministic.

Registered scenario specs run shared rules and profiles across the complete changed-file set;
they do not claim ownership of every task in the branch. Every task spec, including one without
a scenario, must still pass changed-path ownership. Determine scenario identity from the loaded
scenario files, never from a task's id or type. Preserve all Git path bytes with NUL-delimited
output, and fail if a diff cannot be read. Scenario runs must retain the complete communication
boundary scan and report that task ownership was not checked.

Validation reads the diff by default, including for tasks without a scenario or an explicit
`--since`. Use `--no-diff` only for structural checks of checked-in examples. When neither
`--since` nor a spec `diffBase` is given, the base is the branch's own upstream — the work this
branch has not pushed yet — falling back to `origin/main` when there is no upstream (detached
HEAD, CI checkout). A long-lived integration branch diverges from `origin/main` by thousands of
files, and that fallback failed the changed-path ownership gate for every task spec. An empty
diff still passes, but it prints a NOTE naming the base so a green run is never silently vacuous.
