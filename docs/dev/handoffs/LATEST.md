# FP-P4-02 handoff (2026-07-29)

## Current task

- Completed: `FP-P4-02` Browser supervised component graduation.
- Status: `done`; implementation, task-scoped validation, repository `git diff --check`, and shared-tree Harness diff-coverage all pass. G4/G5 remain `engineering-validation-only`.
- Next task: `FP-P4-01` SEKB assisted UI independent graduation.

## Frozen boundaries

- Keep `liveReady=false`, `productApproved=false`, `defaultOn=false`, and Agent merge OFF.
- Unsupervised Browser and private-network access remain permanently denied.
- Do not start `FP-P4-03` or `FP-P4-04`; do not unblock `TF-0006`, `TF-0011`, or `TF-0014`.
- Do not modify `.agent-workbench/task-forest/`, apply proposals, push, create a PR, reset, checkout, stash, clean user work, use real credentials, or perform remote mutation.
- Fixture/synthetic evidence must not be represented as human, real-public-network, clean-VM, safety-reviewer, live, product-approved, default-on, or GA evidence.

## Implemented

- New tasks persist as `waiting-approval`; approval is Main-owned, task-id-only, and single-use. Reject and retry require no browser effect before a fresh approval.
- The Main executor runs ordered `navigate`, `wait-for-selector`, and `click` steps with bounded waits, cancellation, counters, lineage, typed failure codes, and typed success verification.
- Initial URLs, every navigation, redirects, frames, subresources, and click-produced URLs remain subject to public-network and approved-domain checks.
- Actual BrowserWindow requests use the Electron session `resolveHost()` result for private/special-address checks. Popup creation is denied with `POPUP_NAVIGATION_DENIED`, and its persisted error message never includes the popup URL.
- Renderer uses typed host-api only. The Browser workbench shows objective, target, approved domains, mode, permission scope, execution plan, step state, verification, retry, rejection, and cancellation in en/zh/ja/ru.
- Three READMEs describe the supervised workflow and retain the unattended/private-network prohibition.

## Validation evidence

- `pnpm run lint`: exit 0, 0 errors, 116 existing warnings.
- `pnpm run typecheck`: passed.
- `pnpm test`: passed; 6410 main + 25 isolated + 227/10/77 DCS tests.
- Focused Browser suite: 33 files / 375 tests passed.
- `pnpm contract:check`: passed.
- `pnpm run build:vite`: passed with fresh renderer/Main/preload bundles.
- Direct Playwright after that build: Browser workbench + security recovery, 2/2 passed.
- `pnpm run comms:replay` and `pnpm run comms:compare`: passed.
- Task-scoped diff/whitespace checks: passed.
- Repository `git diff --check`: passed after clearing 23 inherited P0/P1 trailing-whitespace findings; the underlying old-test logic differences were preserved.
- `artifacts/first-product-preview/FP-P4-02/synthetic-soak.json`: 20/20 fixture-synthetic, mocked DNS/runtime/page, no network effects, no credentials.
- Screenshots: `browser-workbench-desktop.png`, `browser-workbench-narrow.png`, and `browser-approval-narrow.png`; visual inspection found no overlap or clipping.

## Checkpoint outcome

The cumulative pre-P4 evidence refresh, P3→P4 phase decisions, and inherited P0/P1 test differences were preserved in three local checkpoint commits. The remaining FP-P4-02 increment then passed both repository `git diff --check` and the formal shared-tree Harness command without widening `touchedAreas` or discarding any user work.

## Evidence handling

`artifacts/first-product-preview/FP-P4-02/` is covered by the repository's broad `artifacts/*` ignore rule. The files exist locally but do not appear in ordinary `git status`; when the user later authorizes staging/commit, explicitly include the FP-P4-02 evidence directory so it is not silently omitted.

The pre-consolidation workspace is recoverable from local backup commit `92fd612bb` on branch `codex/p4-preconsolidation-backup`. Local `main` is now 10 commits ahead of `origin/main`; no Task Forest or remote state was changed.
