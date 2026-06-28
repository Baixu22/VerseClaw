# Line C Grounding Controlled Internal Opt-in Readiness Deep Validation

## Quantitative Acceptance Matrix

| Validation area | Metric | Observed value | Threshold | Status | Interpretation |
| --- | --- | ---: | ---: | --- | --- |
| Five consumers | `consumerCoverageCount` | 5 | 5 | pass | Registry, Trace, Symbol, AgentMap, and Runtime Memory were all measured. |
| Hostile sentinels | `sentinelClassCoverageCount` | 14 | >= 14 | pass | Runtime, completion, provider ordering, prompt, durable fact, memory promotion, fact acceptance, episode write, memory persistence, patch mutation, symbol mutation, raw-like metadata, include flags, and untrusted refs were covered. |
| Hostile locations | `hostileInputLocationCoverageCount` | 5 | >= 5 | pass | Options metadata, query metadata/flags, trusted ref metadata, untrusted ref metadata, and summary item metadata were exercised. |
| Leak prevention | `leakCount` | 0 | 0 | pass | No raw or authority-grant sentinel survived emitted diagnostics metadata. |
| Raw retention | `rawLeakCount` | 0 | 0 | pass | Raw-like keys and raw sentinel strings were absent from emitted metadata. |
| Authority retention | `authorityGrantLeakCount` | 0 | 0 | pass | Authority-grant sentinel strings were absent from emitted metadata. |
| Raw flag coercion | `includeRawForcedFalseRate` | 1 | 1 | pass | All measured consumers emitted `query.includeRaw === false`. |
| Untrusted flag coercion | `includeUntrustedForcedFalseRate` | 1 | 1 | pass | All measured consumers emitted `query.includeUntrusted === false`. |
| Untrusted refs | `untrustedRefExclusionRate` | 1 | 1 | pass | No measured consumer emitted an untrusted summary item. |
| Baseline parity | `contextItemsDiffCount` | 0 | 0 | pass | Diagnostics did not change provider context items; Registry emitted no context items. |
| Baseline parity | `evidenceRefsDiffCount` | 0 | 0 | pass | Diagnostics did not change provider evidence refs; Registry emitted no provider results. |
| Provider ordering | `providerOrderingDiffCount` | 0 | 0 | pass | Registry default provider order stayed unchanged. |
| Metadata-only | `diagnosticsMetadataOnlyScore` | 1 | 1 | pass | Diagnostics added only diagnostics/result metadata. |
| No authority markers | `noAuthorityMarkerCompletenessScore` | 1 | 1 | pass | All required no-authority markers were present. |
| Boundary scans | `boundaryScanPassRate` | 1 | 1 | pass | Required scans passed or matched only benign existing owner/policy/test/report text. |
| Regression confidence | `regressionProofConfidenceScore` | 1 | 1 | pass | Coverage, leak, baseline-diff, marker, and scan gates all reached the accepted threshold. |
| No-authority markers | `noAuthorityMarkerObservedCount` | 98 | 98 | pass | Every required common and consumer-specific marker was observed. |
| No-authority markers | `noAuthorityMarkerExpectedCount` | 98 | 98 | pass | The expected marker denominator was fully covered. |

## Required Qualitative Gates

| Gate | Expected result | Status |
| --- | --- | --- |
| Flag-off/default-off parity | Absent or disabled diagnostics keep Registry/Trace/Symbol/AgentMap/Runtime Memory output equal to baseline. | pass |
| Explicit opt-in | Diagnostics metadata appears only when explicitly enabled. | pass |
| Authority markers | Every output remains `authority: "none"` and `rawRetained: false`. | pass |
| Raw retention | Raw prompt, raw trace, payload, checkpoint, tool args/output, stdout/stderr, env, secret, API key, auth header, trace-context, transcript, and JSONL sentinel classes are not retained. | pass |
| Baseline diffs | `contextItemsDiffCount = 0`, `evidenceRefsDiffCount = 0`, and `providerOrderingDiffCount = 0`. | pass |
| Budget/performance | Large refs, long paths, and multi-consumer enabled cases remain bounded; token budgets and stable sorting are covered by existing focused tests. | pass |
| Rollback | Removing the spec/handoff/index entry leaves no runtime residue, migration, sidecar, cache, database, or default output change. | pass |

## Scope Interpretation

The observed values prove controlled internal opt-in readiness only. They do not prove default-on readiness, production readiness, prompt/model-message readiness, provider-ordering readiness, runtime-decision readiness, persistence readiness, UI readiness, memory-promotion readiness, patch-application readiness, or symbol-mutation readiness.

Status: accepted
