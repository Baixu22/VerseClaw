# P1 batch 8: active docs path hygiene and artifact coverage

- Date: 2026-10-10
- Issues: #69, #74
- driven_by: agent
- actor: codex-p1-batch8

## Implemented behavior

1. **#69** - replaced developer-local `%USERPROFILE%`-style absolute paths in the 20 active `AGENTS.md`/`docs/**/*.md`
   files with portable `%USERPROFILE%` or repository-relative paths.
2. Added `scripts/check-local-paths.mjs` and a CI step so new local absolute
   paths in active documentation fail the check.
3. **#74** - verified that `artifacts` is covered by
   `reviewedDirectories`; repository artifact retention reports zero
   shadow-tracking findings on the candidate.

Historical artifacts, reports and plans are intentionally left unchanged as
evidence records.
