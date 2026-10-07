# Windows Electron test process cleanup

The desktop acceptance run recorded a Windows worker exit `3221226505`
(`0xC0000409`). A subsequent targeted rerun passed. Fifteen further repetitions
of the memory-injection case also passed with native diagnostic reports enabled;
the original spontaneous native failure has not been reproduced or attributed
to a particular application call.

The cleanup failure is reproducible separately. On Windows, Playwright 1.59
launches Electron through `cmd.exe`. `app.process().pid` identifies that wrapper,
which may already have exited while the real Electron application survives.
An injected abort immediately after spawn, before Playwright finishes launch
registration, reproduced a surviving Electron process with a dead wrapper.
This fault injection is agent-driven and is not the spontaneous native crash.

The root Playwright configuration now allocates a unique temporary directory
for each Windows run. Shared fixtures place their isolated profiles there and
pass the exact profile via `--user-data-dir`. Runner-owned global teardown
queries only Electron processes carrying that run's profile path and reclaims
their process trees. It also runs when a worker cannot execute its fixture
teardown. Other runs and normal desktop profiles are outside that boundary.
Custom Playwright configurations using these fixtures should include the same
global setup to receive this protection.

Cleanup writes `electron-process-cleanup.json` under the test output directory.
An uncleaned process fails teardown; the original failed test stays failed.
Profiles left by a crash are retained for diagnosis. Set `TEMP` and `TMP` to a
D: task directory when running locally. Product startup, transport, permissions,
test retries, and screenshot tolerances are unchanged.

## Verification on 2026-10-07

The B2 brand was committed separately as `9a437ef60`. Its seven source hashes,
four screenshot hashes, six original candidates/prompts, icon containers and
dated README assets were checked against the existing manifests. Historical
evidence and prompts retain their original bytes.

The final focused Electron run passed all 15 cases with zero skips or retries:
four B2 light/dark sidebar/setup cases, three memory-panel cases, manual
compression, six startup cases, and the worker-abort regression. In the latter,
Electron PID 34320 was alive with parent wrapper PID 34532 already absent;
runner cleanup reclaimed it and left the other run's live application intact.
The nested failed test retained its nonzero result. Parent-owned fallback cleanup
also runs if the nested runner fails or times out, using a setup record written
before any worker starts.

Full typecheck, scoped ESLint, task Harness validation and dry-run, comms replay
and comparison all exited 0. Structured autoreview's second pass had no findings;
its three earlier findings were fixed (fallback cleanup, nested report overrides,
and explicit wrapper-liveness assertions). These results do not claim that the
original spontaneous `0xC0000409` has been eliminated, or that the full desktop
suite or a new installer was validated in this follow-up.

Raw reports, injected-fault logs and screenshots are retained at
`D:/ClawX-work/electron-stability-20261007/`. Key records are
`brand-provenance.json`, `brand-assets.json`, `repeat-before.json`,
`orphan-launch-abort-4/verified-processes.json`, `regressions-final.json`,
`regression-final-results/`, `static-final-exits.json`,
`final-harness-exits.json` and `review-2.json`.
