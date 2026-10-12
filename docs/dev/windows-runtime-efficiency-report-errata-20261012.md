# Windows runtime-efficiency report errata (issue #169)

- Date: 2026-10-12
- Issue: #169
- driven_by: agent
- actor: codex
- Verified base: `origin/main = 85e56295d`
- Original report: `Verse Claw Windows 处理措施调研` (branch
  `arena/aa2ae71f-verseclaw`, base `8f87c615`)
- Scope: errata index. The original report is not rewritten here; its verified
  conclusions remain usable after applying the corrections below.

## Why this exists

The report correctly described most of the Windows runtime-efficiency surface,
but four factual coordinates would send a later audit to the wrong source or
claim. This document records the corrections so the report's conclusions are
not reused with stale wiring or default-value language.

## Corrections

### 1. Runtime resource-lease source does not exist

The report listed
`openclaw_runtime/src/agents/resource-leases.ts` as the runtime-wide lease
implementation. That file is absent from the verified base. It was removed as
dead orchestration code in `3eb339b5d`; the five lease kinds survive only as
historical design text in archived specs.

The current Main-process lease implementation is:

- `electron/services/resource-leases.ts`

### 2. Resource-lease wiring changed after the report base

At the report base (`8f87c615`), `electron/services/resource-leases.ts` had no
production consumers: `withWorkspaceExecLease` was only referenced by the module
itself, and `electron/services/terminal-api.ts` called Gateway RPC directly.

That is no longer the current state. Issue #162 wired the lease into Main
`terminal.run` admission:

- `electron/services/terminal-api.ts` imports `withWorkspaceExecLease` and wraps
  the normal and approved exec paths.
- `tests/unit/resource-leases.test.ts` exists again.
- Final repair commit `f00661a26` is an ancestor of the verified base.

Therefore the accurate statement is:

> The report was written while the lease was unimplemented as a production
> dependency. Current main wires it into Main `terminal.run` RPC admission only;
> it is not an OS-process limit and does not cover search, writer, subtree
> mutation, or cross-process work.

Do not reopen #162 or restate the report's currently-unwired conclusion.

### 3. Correct file coordinates

Two report coordinates do not refer to existing files:

| Report coordinate | Current source |
|---|---|
| `electron/services/openclaw-doctor.ts` | `electron/utils/openclaw-doctor.ts` |
| `electron/services/browser-lifecycle-cleanup.ts` | `openclaw_runtime/src/browser-lifecycle-cleanup.ts` |

### 4. `observationMasking` default-value wording

The report/audit table said
`runtime.contextFamily.observationMasking.enabled = false`. That is not an
accurate production-default statement. The verified base has no default
injection point that writes `runtime.contextFamily.observationMasking`;
unconfigured means the leaf is undefined and not effective.

`openclaw_runtime/src/config/runtime-feature-leaves.ts` contains
`observationMasking: { enabled: true, ... }` as a schema-parity /
`DeepRequired` sample. It is not a production default.

Use this wording instead:

> `runtime.contextFamily.observationMasking` is not configured by default and is
> therefore not effective unless explicitly set. Adding a production default is
> a separate product decision, not a correction to the existing default.

## Verification coordinates

Run from the repository root:

```powershell
git cat-file -e origin/main:electron/services/resource-leases.ts
git cat-file -e origin/main:electron/utils/openclaw-doctor.ts
git cat-file -e origin/main:openclaw_runtime/src/browser-lifecycle-cleanup.ts
git grep -n "withWorkspaceExecLease" origin/main -- electron/services/terminal-api.ts
```

Expected: the three corrected paths resolve, and the grep finds the lease call
inside `terminal-api.ts`. Negative coordinates
(`openclaw_runtime/src/agents/resource-leases.ts`,
`electron/services/openclaw-doctor.ts`,
`electron/services/browser-lifecycle-cleanup.ts`) must not resolve.

## Boundary

- This is documentation-only. No product source, runtime behavior, host-api
  contract, permission default, product lock or frozen default changed.
- #168 remains the deferred index for Job-object readback, CPU throttling and
  long-window FD/RSS measurement. It does not authorize implementation.
- Verification is `driven_by: agent`; no human verdict or human data is claimed.