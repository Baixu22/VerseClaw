# StepFun real-model acceptance — 2026-10-09

`driven_by: agent` · `actor: codex-stepfun-real-acceptance`

This is the owner-requested continuation of real-model acceptance using the
previously supplied Step Plan endpoint and `step-5-preview`. The bounded script ran
against real HTTPS model responses and a real isolated Runtime Gateway, including
one actual Runtime `read` tool call. No synthetic network response, computer-use,
other model, or product-default change was used.

The first attempt exited before reaching the provider because the isolated Runtime
`node_modules` was empty (missing `tslog`); that failure is preserved. The repair
only created junction links to dependencies already installed in the main checkout
(no source, lockfile, or package change). The Gateway-only continuation then passed.
Direct calls were not repeated, so attempts are reported separately.

## Result

| Check | Result and scope |
| --- | --- |
| Real HTTPS streaming | HTTP 200, exact text `STREAM-LIVE-OK`, provider usage returned |
| Real function selection | Model chose `lookup_fixture`, agent executed a synthetic lookup, model consumed the value (not Runtime filesystem evidence) |
| Real Gateway turn 1 | HTTP 200, provider/model `stepfun-evidence/step-5-preview`, exact `RUNTIME-LIVE-OK-1` |
| Real Gateway turn 2 | Exact cross-turn recall of the random `marker-7524fa0c` |
| Real Runtime read tool | Model selected `read` once; Runtime read the newly generated `live-read-fixture.txt`; non-error tool result; final reply matched the random file value |
| Runtime usage/cache | Aggregation fresh (1 cached file, 0 pending/stale); per-turn usage recorded |
| Transcript | 8 messages (3 user / 4 assistant / 1 toolResult), 0 errors, random file value absent from user prompts, fixture bytes unchanged |
| Attempt budget | 7 provider requests (max 8), 3 Gateway user turns, 0 automatic retries |
| Credential scan | 51 raw files + curated source/evidence files scanned for the exact supplied key and common shapes; 0 hits |
| Cleanup | Script Gateway exited; independent process check found no remaining runner/Gateway PIDs |

Consolidated usage across both attempts: 27,960 prompt / 281 completion / 28,241
total tokens (19,456 cache-read). Monetary fees are unknown; the runtime zero-cost
defaults are not treated as free calls.

## Candidate and evidence

Acceptance was read back from disk: the consolidated report, per-attempt runner
result, session histories, transcript and summary, usage aggregation, credential
scan, independent process observation, runtime asset digests, and dependency-repair
receipt. Source candidate `0d8fa48a5c5ae6ee064acc497839e99e80bc693f`, clean tree.
Runtime assets were identity-checked before reuse (production fix `2749f07b2`); this
is not a fresh install or build qualification.

Curated evidence is committed under `artifacts/stepfun-real-acceptance-20261009/`
(`report.json`, `credential-scan.json`, `SHA256SUMS`). Raw receipts, including the
preserved first-attempt failure, live in
`D:/ClawX-work/stepfun-real-acceptance-20261009/`. Original failures are preserved;
no accepted report is overwritten.

This bounded real-model evidence cannot establish broad model quality, all tool
permissions, desktop/platform release readiness, or default-on graduation. Default
runner and product tool policy stay deny-all; only explicit
`LIVE_MODEL_RUNTIME_READ=1` allowed workspace-scoped `read` in the isolated test
configuration.
