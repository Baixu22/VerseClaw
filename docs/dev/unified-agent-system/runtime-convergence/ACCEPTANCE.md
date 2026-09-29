# Engineering Acceptance Contract

## Evidence Separation

| Verdict | Meaning | May set program `done` |
|---|---|---|
| focused tests passed | local implementation evidence | no |
| Harness validated | scope/rules/declared gates consistent | no |
| engineering accepted by Agent | clean candidate reproduced by independent Verifier | no |
| human accepted | user completed RC-10 and recorded `accepted` | yes, if all earlier verdicts pass |

Synthetic fixtures, mocked E2E, agent-surrogate runs, and model-written reports never count as human/live evidence.

## Per-Package Exit Gate

Every RC package must provide:

1. one scoped Harness task spec referencing `runtime-authority-convergence-boundary`; communication work also references `gateway-backend-communication`;
2. an owned-path list, explicit forbidden patterns, rollback, feature flags, focused tests, and acceptance criteria;
3. unit/contract tests for the changed owner and failure paths;
4. restart, idempotency, migration, and rollback tests when state or effects change;
5. Electron E2E and four-locale coverage for visible behavior;
6. `pnpm harness validate --spec <spec>` without `--no-diff` for real implementation review;
7. a clean candidate manifest and independent Agent Engineering Acceptance result;
8. Task Forest and `STATUS.md` updates only after evidence exists.

## Required Commands By Change Type

| Change | Required gates |
|---|---|
| All | focused tests, `pnpm run lint:check`, `pnpm run typecheck`, scoped Harness validate |
| Runtime/context/memory | relevant OpenClaw Vitest configs, root contract tests, kill/flag-off tests |
| Communication | `pnpm run comms:replay`, `pnpm run comms:compare`, contract checks |
| Renderer-visible | `pnpm run i18n:lint`, `pnpm run build:vite`, focused Electron E2E |
| Schema/store | Kysely/schema checks, reopen/replay, migration and downgrade proof |
| MCP | real protocol handshake/conformance fixture, config/runtime parity |
| OTel | exporter-off parity, redaction tests, neutral OTLP golden trace |

The active Harness spec contains the exact commands. This table cannot be used to omit a spec-declared gate.

## Final Engineering Gate

RC-09 requires a clean committed candidate and all of the following:

```text
pnpm run lint:check
pnpm run typecheck
pnpm test
pnpm run contract:check
pnpm run i18n:lint
pnpm run comms:replay
pnpm run comms:compare
pnpm run harness:ci
pnpm run build:vite
pnpm run test:e2e
pnpm agent-dev:deep-test
pnpm agent-dev:audit
pnpm run channel:conformance
```

RC-09 must create `harness/specs/tasks/runtime-authority-convergence-final-acceptance.md` with `humanEvidence: required`. Its `diffBase` equals `acceptedBaseSha` from `artifacts/runtime-authority-convergence/rc-01/baseline.json`; its manifest and independent Verifier report paths are fixed under the existing acceptance owner at `artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json` and `artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/final-report.json`; literal placeholders are forbidden.

Then execute the repository acceptance protocol from PowerShell. The preflight prevents the acceptance CLI's legacy invalid-ref fallback and fixes the output directory:

```powershell
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$finalSpec = "harness/specs/tasks/runtime-authority-convergence-final-acceptance.md"
$baselinePath = "artifacts/runtime-authority-convergence/rc-01/baseline.json"
$finalDir = "artifacts/agent-engineering-acceptance/runtime-authority-convergence-final"
$manifestPath = Join-Path $finalDir "manifest.json"
$finalReportPath = Join-Path $finalDir "final-report.json"
if (Test-Path -LiteralPath $finalDir) { throw "final evidence directory already exists; review and archive it before a new RC-09 run" }
$baseline = Get-Content -Raw -Encoding UTF8 $baselinePath | ConvertFrom-Json
$acceptedBaseSha = [string]$baseline.acceptedBaseSha

if ($baseline.schema -ne "runtime-authority-convergence-baseline/v1") { throw "invalid RC-01 baseline schema" }
if ($acceptedBaseSha -notmatch '^[0-9a-fA-F]{40}$') { throw "invalid acceptedBaseSha" }
git cat-file -e "$acceptedBaseSha^{commit}"
if ($LASTEXITCODE -ne 0) { throw "acceptedBaseSha is not a commit" }
git merge-base --is-ancestor $acceptedBaseSha HEAD
if ($LASTEXITCODE -ne 0) { throw "acceptedBaseSha is not an ancestor of HEAD" }

pnpm acceptance:agent:plan --spec $finalSpec --since $acceptedBaseSha --output-dir $finalDir
if ($LASTEXITCODE -ne 0) { throw "acceptance plan failed" }
$finalManifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
if ($finalManifest.schema -ne "agent-engineering-acceptance/v1" -or $finalManifest.manifestVersion -ne 1 -or $finalManifest.executionMode -ne "full") { throw "invalid final manifest contract" }
if ($finalManifest.baseRef -cne $acceptedBaseSha) { throw "final manifest baseRef mismatch" }
if ($finalManifest.candidate.cleanAtPlan -ne $true) { throw "candidate was dirty at plan" }
if ($finalManifest.task.humanEvidence -ne "required" -or $finalManifest.safety.humanEvidence -ne "required") { throw "final manifest lost human-evidence residual" }
$expectedChangedPaths = @(git diff --name-only "$acceptedBaseSha..$($finalManifest.candidate.commit)" | ForEach-Object { $_ -replace '\\', '/' } | Sort-Object -Unique)
if ($LASTEXITCODE -ne 0) { throw "cannot recompute final changed paths" }
$manifestChangedPaths = @($finalManifest.changedPaths | ForEach-Object { [string]$_ -replace '\\', '/' } | Sort-Object -Unique)
$expectedChangedPathsJson = ConvertTo-Json -Compress -InputObject $expectedChangedPaths
$manifestChangedPathsJson = ConvertTo-Json -Compress -InputObject $manifestChangedPaths
if ($expectedChangedPathsJson -cne $manifestChangedPathsJson) { throw "final manifest changedPaths mismatch" }

pnpm acceptance:agent:run --manifest $manifestPath --actor executor-agent --output-dir $finalDir
if ($LASTEXITCODE -ne 0) { throw "acceptance executor failed" }
pnpm acceptance:agent:verify --manifest $manifestPath --actor verifier-agent --output-dir $finalDir
if ($LASTEXITCODE -ne 0) { throw "acceptance verifier failed" }
pnpm acceptance:agent:status --output-dir $finalDir
if ($LASTEXITCODE -ne 0) { throw "acceptance status read failed" }

$finalReport = Get-Content -Raw -Encoding UTF8 $finalReportPath | ConvertFrom-Json
if ($finalReport.schema -ne "agent-engineering-acceptance/v1") { throw "invalid final report schema" }
if ($finalReport.documentType -ne "agent-engineering-acceptance-report" -or $finalReport.reportVersion -ne 1) { throw "invalid final report contract" }
if ($finalReport.role -ne "verifier") { throw "final report is not independent Verifier evidence" }
if ($finalReport.result -ne "pass" -or $finalReport.engineeringAcceptedByAgent -ne $true -or @($finalReport.failures).Count -ne 0) { throw "engineering acceptance is not green" }
if ($finalReport.conclusion.engineeringAcceptedByAgent -ne $true) { throw "final report conclusion is not green" }
if ($finalReport.humanEvidenceRequired -ne $true -or $finalReport.taskStatusRecommendation -ne "review_needed" -or $finalReport.conclusion.residualHumanEvidence -ne $true) { throw "final report lost human-evidence residual" }
if ($finalReport.runId -ne $finalManifest.runId) { throw "final report runId mismatch" }
if ($finalReport.source.manifestDigest -ne $finalManifest.manifestDigest) { throw "final report manifest digest mismatch" }
if ($finalReport.candidate.commit -ne $finalManifest.candidate.commit) { throw "final report candidate mismatch" }
if ([string]::IsNullOrWhiteSpace([string]$finalReport.executorActor) -or [string]::IsNullOrWhiteSpace([string]$finalReport.verifierActor) -or $finalReport.executorActor -eq $finalReport.verifierActor) { throw "Executor/Verifier identity separation failed" }
if ($finalReport.safety.productLocksChanged -ne $false -or $finalReport.safety.liveReady -ne $false -or $finalReport.safety.productApproved -ne $false -or $finalReport.safety.defaultOn -ne $false -or $finalReport.safety.promotionAuthorized -ne $false -or $finalReport.conclusion.allowedPromotion -ne $false) { throw "product lock or promotion drift" }
node scripts/validate-runtime-authority-convergence.mjs --phase engineering --manifest $manifestPath --engineering-report $finalReportPath
if ($LASTEXITCODE -ne 0) { throw "runtime convergence engineering evidence validator failed" }
```

The generated manifest must record `baseRef` equal to the resolved `acceptedBaseSha`; its `changedPaths` must equal `git diff --name-only <acceptedBaseSha>..<candidateSha>`; source inputs must use candidate Git blob identity rather than checkout-specific CRLF/LF bytes; and both manifest evidence fields must remain `required`. The final report must be a green Verifier report whose `runId`, candidate commit, and `source.manifestDigest` match that manifest, whose Executor and Verifier identities differ, whose human residual fields remain true/`review_needed`, and whose semantic `reportDigest` validates under the existing acceptance library. RC-00 must add regression coverage proving an invalid or missing base exits nonzero instead of falling back to `HEAD` or `HEAD^`.

The cumulative diff must be partitioned totally and disjointly by `artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/changed-path-ownership.json` (schema `runtime-authority-convergence-rc09-ownership/v2`): every path is either RC-owned by exactly one package from the required owner set — derived from the final spec's `cumulativeOwnership.requiredSpecs`, so RC-10 and the RC-01R variant specs can never own a path — or excluded with the SHA, subject and derived workstream of the non-RC commit that first introduced it. The RC chain is re-verified on the shared integration branch, so the excluded set is non-empty by construction; recording each excluded path by name is what keeps ownership globs from being widened to absorb another workstream. A missing path, a duplicate path, an owner outside the required set, an unattributed exclusion, or a count that disagrees with the manifest fails closed.

The engineering and human validators run either at the candidate or at any descendant whose candidate→worktree diff touches only the final spec's `closureAdvance.allowedPaths` (read from the candidate's copy of the spec). When HEAD has advanced, the validator judges the candidate in a detached worktree of the candidate and fails closed on a non-descendant HEAD, a frozen input (manifest source files, provision copies including the ownership matrix, the RC-01 baseline, the validator and its library), a code file, or any non-closure path. Closing a round therefore no longer makes its evidence unreplayable: after the closure commits, **re-run the validator once on the closed HEAD** and record that run as the replayable evidence. Before trusting a replay, confirm `git diff <candidateSha> -- scripts/ harness/ package.json pnpm-lock.yaml` is empty so the validator that ran is the candidate's own. Do not regenerate `changed-path-ownership.json` after the candidate. Design and rationale: `RC-09-CLOSURE-ADVANCE-FIX-PLAN.md`.

The candidate SHA creation method follows the session's Git authorization. Without a clean candidate SHA, RC-09 remains `engineering_verification`; it cannot be waived.

## Hard Vetoes

- any required command fails, times out, gains an undeclared skip, or uses stale evidence;
- payload parity changes during a shadow package;
- unregistered semantic mutation or duplicate side effect is observed;
- a second persistent authority, service, protocol, or telemetry store is added;
- a prunable/default-off diagnostic log is selected as receipt truth without schema, retention, lookup, idempotency, privacy, and restart proof;
- RuntimeTaskEventLog replay/reducer/resume or runtime-spine is promoted to lifecycle/effect authority;
- restart recovery is claimed while approval truth remains process-local or an unknown effect outcome is auto-replayed;
- the npm fallback reports source-runtime receipt capability or contributes to receipt-readiness coverage;
- secrets or raw prompt/tool content are persisted by default;
- product locks change from false;
- Executor and Verifier identities are the same;
- a human/live count is increased by automation.

## Status Transition

```text
planned -> in_progress -> engineering_verification
  -> human_acceptance_pending -> done
```

Failure at any gate moves the active package to `review_needed`. `done` requires the final user verdict.
