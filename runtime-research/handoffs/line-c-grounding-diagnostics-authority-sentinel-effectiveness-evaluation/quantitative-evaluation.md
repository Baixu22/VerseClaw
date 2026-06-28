# Line C Grounding Diagnostics Authority Sentinel Effectiveness Quantitative Evaluation

## Metric Table

| Metric | Exact observed value | Pass threshold | Status | Interpretation |
| --- | ---: | ---: | --- | --- |
| `consumerCoverageCount` | 5 | 5 | pass | Registry, Trace, Symbol, AgentMap, and Runtime Memory were all measured. |
| `sentinelClassCoverageCount` | 14 | 14 | pass | Runtime, completion, provider ordering, prompt, durable fact, memory promotion, fact acceptance, episode write, memory persistence, patch mutation, symbol mutation, raw-like metadata, include flags, and untrusted refs were covered. |
| `hostileInputLocationCoverageCount` | 5 | 5 | pass | Options metadata, query metadata/flags, trusted ref metadata, untrusted ref metadata, and summary item metadata were exercised. |
| `leakCount` | 0 | 0 | pass | No raw or authority-grant sentinel survived emitted diagnostics metadata. |
| `leakRate` | 0 | 0 | pass | Zero leaks across `5 * 14` consumer/sentinel slots. |
| `rawLeakCount` | 0 | 0 | pass | Raw-like keys and raw sentinel strings were absent from emitted metadata. |
| `authorityGrantLeakCount` | 0 | 0 | pass | Authority-grant sentinel strings were absent from emitted metadata. |
| `includeRawForcedFalseRate` | 1 | 1 | pass | All measured consumers emitted `query.includeRaw === false`. |
| `includeUntrustedForcedFalseRate` | 1 | 1 | pass | All measured consumers emitted `query.includeUntrusted === false`. |
| `untrustedRefExclusionRate` | 1 | 1 | pass | No measured consumer emitted an untrusted summary item. |
| `contextItemsDiffCount` | 0 | 0 | pass | Diagnostics did not change provider context items; Registry emitted no context items. |
| `evidenceRefsDiffCount` | 0 | 0 | pass | Diagnostics did not change provider evidence refs; Registry emitted no provider results. |
| `providerOrderingDiffCount` | 0 | 0 | pass | Registry default provider order stayed `legacy-context-engine`, then `loop-context-pack`. |
| `diagnosticsMetadataOnlyScore` | 1 | 1 | pass | Diagnostics added only diagnostics/result metadata across all five consumers. |
| `noAuthorityMarkerCompletenessScore` | 1 | 1 | pass | All required no-authority markers were present. |
| `boundaryScanPassRate` | 1 | 1 | pass | Required scans passed or matched only benign policy/test-string locations. |
| `regressionProofConfidenceScore` | 1 | 1 | pass | Coverage, leak, baseline-diff, marker, and scan gates all reached the accepted threshold. |
| `noAuthorityMarkerObservedCount` | 98 | 98 | pass | Every required common and consumer-specific marker was observed. |
| `noAuthorityMarkerExpectedCount` | 98 | 98 | pass | The table-driven expected marker denominator was fully covered. |

## Exact Observed Values

The focused unit test `tests/unit/runtime-grounding-authority-effectiveness.test.ts` computes the metric object from real consumer outputs and asserts the exact observed values:

```text
consumerCoverageCount = 5
sentinelClassCoverageCount = 14
hostileInputLocationCoverageCount = 5
leakCount = 0
leakRate = 0
rawLeakCount = 0
authorityGrantLeakCount = 0
includeRawForcedFalseRate = 1
includeUntrustedForcedFalseRate = 1
untrustedRefExclusionRate = 1
contextItemsDiffCount = 0
evidenceRefsDiffCount = 0
providerOrderingDiffCount = 0
diagnosticsMetadataOnlyScore = 1
noAuthorityMarkerCompletenessScore = 1
boundaryScanPassRate = 1
regressionProofConfidenceScore = 1
noAuthorityMarkerObservedCount = 98
noAuthorityMarkerExpectedCount = 98
```

## Pass/Fail Status

Overall status: pass.

Every hard metric gate passed. No production runtime sanitizer or marker fix was needed.

## Interpretation

The accepted grounding diagnostics hardening is quantitatively effective for the tested sentinel set. Hostile authority and raw-retention attempts can enter the test fixture through all planned hostile input locations, but emitted diagnostics metadata remains sanitized, summary-only, non-authoritative, and metadata-only.

The result also proves diagnostics-enabled provider output keeps stable context items and evidence refs relative to baseline for Trace, Symbol, AgentMap, and Runtime Memory. Registry diagnostics keep default provider order unchanged and do not add provider results or context items.

## What This Proves

This proves the current accepted diagnostics consumers maintain these invariants under the measured hostile fixture:

| Proven invariant | Evidence |
| --- | --- |
| Five consumers covered | `consumerCoverageCount = 5`. |
| Sentinel classes covered | `sentinelClassCoverageCount = 14`. |
| Hostile input locations covered | `hostileInputLocationCoverageCount = 5`. |
| No raw retention | `rawLeakCount = 0`; `rawRetained === false`. |
| No authority grant leakage | `authorityGrantLeakCount = 0`; `authority === "none"`. |
| Raw/untrusted flags forced off | `includeRawForcedFalseRate = 1`; `includeUntrustedForcedFalseRate = 1`. |
| Untrusted refs excluded | `untrustedRefExclusionRate = 1`. |
| Metadata-only diagnostics | `diagnosticsMetadataOnlyScore = 1`. |
| Baseline provider output preserved | `contextItemsDiffCount = 0`; `evidenceRefsDiffCount = 0`. |
| Registry ordering preserved | `providerOrderingDiffCount = 0`. |
| Marker completeness preserved | `noAuthorityMarkerCompletenessScore = 1`. |

## What This Does Not Prove

This does not prove any new runtime capability, authority model, prompt assembly behavior, provider selection behavior, persistence behavior, memory promotion behavior, UI behavior, transport behavior, patch behavior, symbol mutation behavior, or workspace mutation behavior.

This also does not prove exhaustive natural-language detection of every future authority synonym. It proves the accepted sentinel classes and hostile input locations are protected now. Future drift should extend the sentinel table explicitly.

## Optimization Recommendations

| Recommendation | Implementation status | Reason |
| --- | --- | --- |
| Reduce duplicated diagnostics metadata assertions | proposal only | The current tests repeat no-authority assertions across consumers; table-driven helpers would reduce maintenance cost. |
| Centralize test fixture construction | proposal only | A shared fixture builder would make future sentinel classes and input locations easier to add. |
| Make marker completeness checks table-driven | partially applied in test only | The new effectiveness test uses a table-driven marker denominator; production runtime remains unchanged. |
| Keep production runtime unchanged unless drift appears | accepted | No sanitizer or marker drift appeared in this evaluation. |

## Future Display Proposal

Future display should show aggregate metrics, not raw hostile data:

| Display element | Content |
| --- | --- |
| Metrics cards | Consumer coverage, sentinel class coverage, leak rate, forced false rates, baseline diffs, confidence score. |
| Matrix view | Consumer-by-sentinel and consumer-by-input-location pass/fail status. |
| Trend view | Historical aggregate values only if future CI persists safe metric history. |
| Redaction policy | Never show raw hostile payloads, raw metadata values, secret-like strings, trace dumps, transcripts, tool args/output, or raw refs. |

Evaluation Status: accepted
