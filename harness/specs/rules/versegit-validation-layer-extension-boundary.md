---
id: versegit-validation-layer-extension-boundary
title: VerseGit Validation-Layer Extension Boundary
type: ai-coding-rule
appliesTo:
  - versegit-validation-layer-extension
  - gateway-backend-communication
severity: error
---

VerseGit (VG) is an **opt-in auxiliary validation layer** for multi-worktree or
multi-concurrent-agent development. It is not the harness authority, not the git
base, and not a second gate owner.

## Authority and non-authority

- ClawX keeps the pass/fail decision. VG may only produce auxiliary facts that
  appear in the harness report as residual or an informational section.
- VG unavailability, uninitialised workspace, unsupported language, parse
  failure, or missing binary must **fail open**: record the reason, leave the
  verdict unchanged. An auxiliary layer must never become a single point of failure.
- VG does not own the change graph, the task graph, the approval plane, the write
  journal, or any product lock. `vg land` / `vg admit` must not be wired into any
  ClawX execution or commit path.
- `selected` / partial VG-STS evidence never satisfies a `requiredTests` full gate.

## Trigger conditions (opt-in only, never default-on)

VG participation is eligible only when the environment is actually concurrent:

- more than one git worktree for the repository, **or**
- more than one active VG session for the repository.

Absence of those conditions means VG does not run at all. A single-worktree
single-session repository must observe zero VG behaviour change. Do not add VG to
the `fast` profile or to any profile a task spec declares by default; a new
profile must stay opt-in per spec.

## Language coverage is an explicit boundary

VG's symbol layer currently covers `.ts` and `.tsx` only. It reports
`unsupported language` for `.mjs`, `.jsx`, and `.sh`. This is honest empty
coverage, not a defect to be papered over: the harness itself is `.mjs`, so do
not present VG results as harness-wide coverage. Any claim of coverage must be
scoped to the languages actually parsed.

## Read-set boundary

VG's read set is partial. Rules that need reads (`ssi/rw-cycle`,
`ssi/dangling-ref`) under-trigger on real sessions; write×write rules
(`ssi/api-drift`, `ssi/silent-co-modification`, `ssi/duplicate-def`) are the
reliable ones. Do not report an SSI-cycle count as a coverage or safety claim.

## Evidence honesty

- VG outputs are recorded as auxiliary evidence with their own identity
  (binary digest, repo, worktree, session set, trigger reason).
- A green VG run never upgrades a harness verdict, and a red VG run must not be
  silently dropped — it must be visible as an auxiliary observation.
- Absence of a VG conflict is not evidence that no conflict exists. Do not write
  "no conflicts found" as a pass statement; write "VG observed no conflict under
  partial coverage".
- Do not add product locks, default-on flags, or GA statements for this layer.

## Ecosystem linkage

VG may be registered as a **deny-by-default read-only capability** through the
existing `verseshell-mcp` compatibility adapter or the existing `.mcp.json`. It
must not become an internal execution path, must not bypass
`verseshell-mcp-compatibility-boundary`, and must not introduce a second executor,
approval channel, or journal.
