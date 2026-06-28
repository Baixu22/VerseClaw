# Line C Grounding Diagnostics Authority Sentinel Effectiveness Evaluation Design Research

## Quantitative Evaluation Model

The model evaluates only diagnostics metadata emitted by the accepted grounding diagnostics consumers. It compares five consumers:

| Consumer | Measured surface | Runtime authority decision |
| --- | --- | --- |
| Registry groundingShadow | Registry diagnostic metadata from `context-provider-registry-grounding-shadow` | No runtime authority; metadata-only diagnostic. |
| Trace groundingDiagnostics | `metadata.groundingDiagnostics` from Runtime Trace provider | No runtime authority; context output must match baseline. |
| Symbol groundingDiagnostics | `metadata.groundingDiagnostics` from Symbol provider | No symbol mutation or prompt authority; context output must match baseline. |
| AgentMap groundingDiagnostics | `metadata.groundingDiagnostics` from AgentMap provider | No prompt/provider-ordering authority; context output must match baseline. |
| Runtime Memory groundingDiagnostics | `metadata.groundingDiagnostics` from Runtime Memory provider | No durable fact, promotion, fact acceptance, episode write, or persistence authority; context output must match baseline. |

The evaluation injects hostile authority and raw-retention attempts through options metadata, query metadata/flags, trusted ref metadata, untrusted ref metadata, and the resulting summary-item metadata path. It then serializes the emitted diagnostics metadata and counts leaks, marker completeness, default trust exclusion, forced raw/untrusted flags, and baseline diffs.

## Metric Definitions And Formulas

| Metric | Formula | Passing threshold |
| --- | --- | --- |
| `consumerCoverageCount` | Count of distinct measured consumers. | `5` |
| `sentinelClassCoverageCount` | Count of sentinel classes injected and asserted. | `14` |
| `hostileInputLocationCoverageCount` | Count of hostile input/output-boundary locations exercised. | `5` |
| `leakCount` | `rawLeakCount + authorityGrantLeakCount`. | `0` |
| `leakRate` | `leakCount / (consumerCoverageCount * sentinelClassCoverageCount)`. | `0` |
| `rawLeakCount` | Count of raw-like keys or raw sentinel strings retained in emitted metadata. | `0` |
| `authorityGrantLeakCount` | Count of authority-grant sentinel strings retained in emitted metadata. | `0` |
| `includeRawForcedFalseRate` | Consumers with emitted `query.includeRaw === false` divided by measured consumers. | `1` |
| `includeUntrustedForcedFalseRate` | Consumers with emitted `query.includeUntrusted === false` divided by measured consumers. | `1` |
| `untrustedRefExclusionRate` | Consumers that emit no untrusted summary items divided by measured consumers. | `1` |
| `contextItemsDiffCount` | Count of provider context item diffs between baseline and diagnostics-enabled output. Registry expected `0` items. | `0` |
| `evidenceRefsDiffCount` | Count of provider evidence ref diffs between baseline and diagnostics-enabled output. Registry expected `0` provider evidence refs. | `0` |
| `providerOrderingDiffCount` | Count of registry default provider-order changes while diagnostics run. | `0` |
| `diagnosticsMetadataOnlyScore` | Consumers where diagnostics add only diagnostics/result metadata divided by measured consumers. | `1` |
| `noAuthorityMarkerCompletenessScore` | Observed required no-authority markers divided by expected required no-authority markers. | `1` |
| `boundaryScanPassRate` | Passed boundary scans divided by required boundary scans. | `1` |
| `regressionProofConfidenceScore` | Weighted score from coverage, zero leaks, metadata-only diffs, marker completeness, and boundary scans. | `1` |

The confidence score is intentionally not a performance score. Timing, if recorded later, should remain advisory metadata and must not become a hard gate.

## Consumer Input Sentinel Coverage Matrix

| Sentinel class | Registry | Trace | Symbol | AgentMap | Runtime Memory |
| --- | --- | --- | --- | --- | --- |
| runtime authority | covered | covered | covered | covered | covered |
| completion authority | covered | covered | covered | covered | covered |
| provider ordering authority | covered | covered | covered | covered | covered |
| prompt authority | covered | covered | covered | covered | covered |
| durable fact authority | covered | covered | covered | covered | covered |
| memory promotion authority | covered | covered | covered | covered | covered |
| fact acceptance authority | covered | covered | covered | covered | covered |
| episode write authority | covered | covered | covered | covered | covered |
| memory persistence authority | covered | covered | covered | covered | covered |
| patch mutation authority | covered | covered | covered | covered | covered |
| symbol mutation authority | covered | covered | covered | covered | covered |
| raw-like metadata | covered | covered | covered | covered | covered |
| includeRaw/includeUntrusted | covered | covered | covered | covered | covered |
| untrusted refs | covered | covered | covered | covered | covered |

## Hostile Input Location Matrix

| Location | Purpose | Expected output |
| --- | --- | --- |
| options metadata | Prove external diagnostics options cannot smuggle raw or authority text. | Sanitized metadata; raw/grant sentinels absent. |
| query metadata / query flags | Prove `includeRaw` and `includeUntrusted` attempts are forced off. | `includeRaw: false`; `includeUntrusted: false`. |
| trusted ref metadata | Prove accepted refs remain summary-only and non-authoritative. | One trusted item with `authority: "none"` and sanitized metadata. |
| untrusted ref metadata | Prove untrusted refs are excluded by default even when requested. | No untrusted item emitted. |
| summary item metadata | Prove sanitized ref metadata cannot become a grant through emitted items. | Item metadata contains no raw/grant sentinel. |

## Expected Pass Thresholds

| Requirement | Threshold |
| --- | --- |
| Consumer coverage | 5 of 5 consumers |
| Sentinel class coverage | 14 of 14 classes |
| Hostile input location coverage | 5 of 5 locations |
| Leak counts | 0 raw leaks, 0 authority grant leaks, 0 total leaks |
| Forced false rates | 100% for `includeRaw` and `includeUntrusted` |
| Untrusted exclusion | 100% |
| Baseline diffs | 0 context item diffs, 0 evidence ref diffs, 0 provider-ordering diffs |
| Metadata-only score | 100% |
| Marker completeness | 100% of required markers |
| Boundary scans | 100% pass or documented benign policy/test-string-only matches |

## False Positive And False Negative Risk Review

| Risk | Type | Review |
| --- | --- | --- |
| Policy words in specs or tests match boundary scans | false positive | Boundary scans may match intentional policy text or test sentinel literals. These should be recorded as benign when no production runtime path was added. |
| Sanitizer removes a sentinel string but a new grant synonym appears later | false negative | This evaluation covers the accepted sentinel set. Future drift should add table rows rather than treating this as natural-language authority detection. |
| Context items differ only by order or evidence dedupe | true failure | Context item and evidence ref comparison uses exact serialized equality because diagnostics must not change provider output. |
| Provider ordering changes outside the test | true failure | Registry order is measured before and after diagnostics. Any default registration or ordering drift should fail. |
| Timing noise | false positive if used as gate | Timing must remain advisory only and is not part of the hard pass threshold. |

## Why This Is Not Runtime Optimization Implementation

The evaluation does not change TaskLoop, Gateway, Main, renderer, host-api, api-client, provider transport, provider ordering, prompt/model-message assembly, runtime execution decisions, memory promotion, persistence, patch application, symbol mutation, or workspace mutation. It observes diagnostics metadata already produced by explicit/default-off consumers and converts the observation into counts and rates.

## Rejected Alternatives

| Alternative | Decision | Reason |
| --- | --- | --- |
| UI dashboard implementation now | Rejected | A UI would add product surface and presentation obligations; this phase only designs future presentation metrics. |
| Telemetry/exporter/listener | Rejected | Export paths create service, retention, and transport concerns outside diagnostics-only evaluation. |
| Persistence/database | Rejected | The task must not retain hostile payloads or add any runtime state store. |
| Runtime/prompt/provider-ordering cutover | Rejected | Grounding diagnostics must not become prompt authority, provider selection authority, or runtime execution input. |
| Memory promotion/fact acceptance | Rejected | Memory refs remain anchors only and cannot create durable facts, accepted facts, episodes, or invalidations. |
| Patch/symbol mutation | Rejected | Source and symbol refs remain readonly evidence/relevance anchors only. |

## Optimization Proposal

Future work may reduce duplicated diagnostics metadata assertions by centralizing a shared marker expectation table in tests. It may centralize test fixture construction for the five consumers so hostile input locations and sentinel classes are easier to extend. Marker completeness checks should become table-driven to make future drift explicit. Production runtime should remain unchanged unless a quantitative test exposes sanitizer or marker drift.

## Future Presentation

Recommended metrics cards:

| Card | Value |
| --- | --- |
| Consumers covered | `consumerCoverageCount / 5` |
| Sentinel classes covered | `sentinelClassCoverageCount / 14` |
| Leak rate | `leakRate` |
| Forced false rates | `includeRawForcedFalseRate`, `includeUntrustedForcedFalseRate` |
| Baseline diffs | `contextItemsDiffCount`, `evidenceRefsDiffCount`, `providerOrderingDiffCount` |
| Regression confidence | `regressionProofConfidenceScore` |

Recommended matrix view: consumers as columns and sentinel classes/input locations as rows, showing pass/fail counts only.

Recommended trend view if future CI history exists: aggregate metric values over commits or accepted task specs, never raw hostile payloads.

Redaction policy: never show raw hostile payloads, raw metadata values, secrets, trace dumps, transcripts, tool args/output, or raw refs. Show only counts, classes, rates, and pass/fail status.

Design Status: accepted
