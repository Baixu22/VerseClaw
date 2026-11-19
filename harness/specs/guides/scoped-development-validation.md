---
id: scoped-development-validation
title: Scoped development checks before frozen-candidate release acceptance
type: guide
appliesTo:
  - all
---

The owner confirmed this split on 2026-09-28: development validates the changed
surface; formal release keeps full acceptance against a frozen candidate.

During development, run the smallest tests that exercise the changed production
path, targeted lint and the applicable typecheck. Add a regression for the root
cause. Run comms checks for communication changes, and focused Electron coverage
when the visible interaction changes. Do not launch the full RC-09 suite after
every bug fix. A development run must report commands, exits, counts, timing and
omissions; it cannot claim formal RC acceptance.

For channel startup and the RC-10 driver, use:

- `pnpm run test:channel-startup`: config sync, sidecar and real local IRC transport,
  plus runtime sidecar unit tests. No build, Electron or paid provider.
- `pnpm run check:rc10:dev`: the above, driver argument/CLI regressions, uncached
  typecheck and targeted lint/syntax checks.
- `pnpm run test:integration` includes the channel regression so the existing
  formal integration gate also covers it.

The channel regression uses a supplied startChannels callback and a real IRC
client; it does not load the complete plugin manager or launch Electron. Keep the
live product scenario for that boundary. H-02..H-06 now have their own real-product driver and a focused Electron E2E
spec. H-01, a TCP connection or a fixture cannot stand in for those scenarios.

Before release, finish scenario development and focused checks, freeze the
candidate, then run the existing full Executor/independent Verifier cycle and
H-01..H-06. One full run means one complete acceptance cycle, including both
roles. If it finds a defect, diagnose with focused checks, fix it, refreeze and
repeat the required formal cycle. Old-candidate verdicts and development results
do not transfer to new product code. Do not change retry counts, assertions, skip
budgets, product locks or candidate/digest binding to save runtime.

Harness `fast` is a historical broad profile name (including the root suite),
not a promise of seconds. Use task-specific development commands; use
`harness run --dry-run` to inspect the formal profile without executing it.

The full fast profile builds the VerseBrowser workspace package before typecheck
and unit imports. Fresh detached checkouts obtain its package declarations and
runtime exports from the locked source instead of depending on a previous Vite build.
