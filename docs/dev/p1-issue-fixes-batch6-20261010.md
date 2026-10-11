# P1 batch 6: dead switches, skips and evidence integrity

- Date: 2026-10-10
- Issues: #70, #76, #93, #95
- driven_by: agent
- actor: codex-p1-batch6

## Implemented behavior

1. **#95** - removed the unwired `runtime.coding.uftk` type/schema/exhaustive
   surface. The strict schema now rejects the retired block.
2. **#76** - added `scripts/report-test-skips.mjs`; it discovers suites that
   use `hasDeepSeekKey()`, runs them with Vitest JSON output and prints
   per-file skipped counts. The CI check workflow invokes it after tests.
3. **#70** - added `scripts/verify-evidence-sha256sums.mjs`. It verifies
   annotated evidence snapshots, accepts exact annotated historical drift, and
   fails on missing or unannotated drift. The two known snapshots now carry
   `INTEGRITY.json` entries for the files that changed after evidence capture.
4. **#93** - `check-evidence-refs.mjs` now validates shared runtime deep-path
   assertions and root package script paths into `openclaw_runtime`. The
   version dual-track issue remains #67.

## Verification boundary

The real skip reporter was executed locally (12 suites, 51 passed, 41
skipped). SHA256 verification and the two annotated drift manifests pass
locally. Remote CI and packaged release are not claimed.
