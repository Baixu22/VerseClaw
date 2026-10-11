---
id: runtime-deep-reference-boundary
title: Vendored Runtime Deep Reference Boundary
type: rule
severity: error
driven_by: agent
appliesTo:
  - gateway-backend-communication
pathPatterns:
  - electron/**
  - src/**
  - shared/**
  - scripts/**
  - scripts/runtime-deep-refs-baseline.json
  - package.json
---
# Rule: references into the vendored runtime must resolve, or be exempted with a reason

`openclaw_runtime/` is a vendored upstream copy (see `openclaw_runtime/UPSTREAM.md`).
Parent code reaches into its internals by deep path in two shapes: code
(`import` / `await import` / `require` with a specifier inside the vendored tree)
and strings (evidence assertions, workspace labels, script arguments, fixture
text). A re-vendor that renames or moves an upstream file breaks both **silently**
— no compile error, no test failure, the capability claim or the tooling simply
stops pointing at a real file. Issue #93 tracks that coupling.

`scripts/check-runtime-deep-refs.mjs` is the standing guard.

## Rules

- A reference from `electron/`, `src/`, `shared/`, `scripts/` or a root
  `package.json` script into `openclaw_runtime/**` must either resolve on disk
  (extension- and `index`-probed, with the ESM `.js` → `.ts` alias) or appear in
  `scripts/runtime-deep-refs-baseline.json` with a non-empty `reason`.
- Prefer fixing the path over adding an exemption. An exemption is a ledger entry
  for accepted debt, never an allowlist for convenience.
- Only two exemption shapes are legitimate: a specifier that is resolved from a
  different root at run time (name that root in the reason, e.g. generated script
  text piped to `tsx -` with `cwd` = repo root), and a path that belongs to a
  pinned historical commit or to build output (name the commit or the producing
  command). "It fails today" is not a reason.
- Do not shrink the scan (excluding a directory, a file stem, or a reference kind)
  to make a tree pass. Fix the reference or file the exemption.
- A stale exemption — one that matches no reference any more — is informational and
  must never fail an unrelated change; prune it when you touch the ledger.
- Never edit a historical manifest's path list to silence this guard. Pinned
  inventories (e.g. `PREREQUISITE_PATHS`, whose length is itself asserted) describe
  a past commit range; their entries are supposed to leave the working tree.

## Limits you must state when you rely on this guard

- The scan is textual: `path.join(root, 'openclaw_runtime', 'src', …)` and other
  concatenated references are invisible, and matches inside comments count.
- Existence is not semantics: a file that still exists but changed its exports
  passes. Only moving the parent code behind a supported entry point, or importing
  symbols so the compiler fails, catches that.
- `tests/` is intentionally out of scope (the TypeScript compiler already fails its
  imports loudly) and so is `harness/` (specification prose holds patterns such as
  `openclaw_runtime/**`, not file references).

## Validation

- `pnpm run check:runtime-deep-refs`
- `pnpm exec vitest run tests/unit/runtime-deep-refs.test.ts`
