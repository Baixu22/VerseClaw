# Live-model runner cleanup follow-up — 2026-10-09

## Scope and implementation

This follows the completed, agent-driven StepFun verification at commit
`d5420d53ad038e713ce4a81fc048fb50ca28f5ff`. Two real Gateway turns passed;
TF-0263 is done. The earlier provider 403 is historical, not a current blocker.
This follow-up makes **zero real-provider calls** and does not requalify the app,
rebuild Windows installers, change product locks, or expand release/platform claims.

The runner originally checked only `ChildProcess.exitCode`. On signal termination
that field remains null while `signalCode` records the exit, so the runner wrote
`gatewayExited=false` and attempted unnecessary `taskkill` after the process had
already gone. A single shared predicate now checks both terminal fields, for
startup readiness, graceful cleanup, forced cleanup selection, and the final report.
A genuinely running owned child still uses the existing bounded tree cleanup path.

## Evidence

- Local red regression against the original production cleanup: **3 passed / 4 failed**, exit 1.
- Patched regression: **7 passed / 0 failed**, exit 0. It covers no child, numeric
  and signal exits, graceful termination, still-running forced cleanup, and an
  actual local Node child; the last check independently requires its PID to be absent.
- Tests execute the cleanup block read from the production script, without loading
  its provider/Gateway calls. The test fixtures are agent-driven, not real-human
  or a substitute for fresh provider/app acceptance.
- Curated report: `artifacts/live-model-cleanup-20261009/report.json`.
- Original raw logs: `D:/ClawX-work/live-model-cleanup-20261009/`.
- Original StepFun report, credential scan, and SHA256SUMS are preserved byte-for-byte.
  Its manifest remains an identity check against the original committed candidate,
  not a claim that a later edited script/spec has the original bytes.

This is an internal verification-script correction. README.md, README.zh-CN.md,
README.ja-JP.md and README.ru-RU.md need no behavior/API update: product behavior
and the advertised installation/usage flows are unchanged.
