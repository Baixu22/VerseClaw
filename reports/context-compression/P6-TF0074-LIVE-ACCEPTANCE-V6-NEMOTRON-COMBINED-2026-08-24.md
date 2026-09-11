# P6-TF0074 v6 Nemotron Combined Live Acceptance

Date: 2026-08-24
Status: **FAIL**
Promotion: `promotionStage: "shadow"`

## Scope and Evidence Integrity

Three independent live stages were run against the same fixed 30-sample real transcript manifest. The evaluator model was `nvidia/nemotron-3-ultra-550b-a55b:free`; the compaction model was `deepseek-chat`, so model independence passed.

- Fixed manifest: `reports/context-compression/production-manifest-30.json`
- Manifest resolution: `30/30` in every stage
- Real coverage: `30/30` judge, `30/30` schema-free, `30/30` continuation
- Cache: disabled (`no-cache`, zero cache hits)
- Secret scan: passed in every stage; no leaks
- Shared manifest hash: `56fa018628a...dbda5c`
- Shared manifest digest: `8d5af65373...b24f9aa`

The three stage directories are:

- `artifacts/p6-tf0074-live-acceptance-v6-nemotron-judge-a1/`
- `artifacts/p6-tf0074-live-acceptance-v6-nemotron-schemafree-a2/`
- `artifacts/p6-tf0074-live-acceptance-v6-nemotron-continuation-a3-r2/`

The earlier continuation attempt using the model id without `-a55b` is invalid and is not included here. The corrected `a3-r2` run is the only continuation evidence used below.

## Stage Results

| Stage | Coverage | Gate | Key result |
| --- | ---: | --- | --- |
| Real judge | 30/30 | **FAIL** | `noFabricationRate=0.9667` (`29/30`), required `>=0.98` |
| Schema-free omission | 30/30 | **PASS** | `majorOrCriticalOmissionRate=0.0667` (`2/30`), required `<=0.10` |
| Real continuation | 30/30 | **PASS** | first/critical action match `1.0`; no repeated or contradictory work `1.0`; completion delta `0` |

### Real Judge

Nemotron scored the summaries at mean `9.9`, minimum `7`, with completeness `1.0`, causal-chain retention `1.0`, and actionability `1.0`. Accuracy and no-fabrication were both `0.9667`.

The failing sample is **R19**. The judge identified a fabricated `Cargo` test result in the generated summary. The transcript evidence and directory listing describe Java/Gradle/Maven artifacts, not Rust/Cargo. This is a genuine unsupported fact insertion, not a provider-coverage failure, and it is sufficient to fail the formal no-fabrication gate.

### Schema-Free Omission

The independent schema-free judge passed the formal major/critical omission threshold at `2/30 = 0.0667`. The two major omission samples remain important residual risks:

- **R12:** omitted the analyzed-files tracking content, the contradiction about whether task #5 had already been analyzed, and evidence for completion of tasks #2-#4.
- **R17:** omitted that manual compaction had not been performed, the discovered `/compact` and compaction-planning paths, CLI unavailability, and the actual context-usage state.

Passing the rate threshold does not make these takeover risks acceptable to ignore; they are retained as regression targets.

### Real Continuation

The corrected continuation run used `evidenceMode=real` and completed all 30 requests. It passed every L3 metric:

- first action match: `1.0`
- critical action match: `1.0`
- no repeated work: `1.0`
- no contradictory action: `1.0` with `0` contradictory actions
- decision consistency: `1.0`
- task completion delta: `0`

Five samples (`R8`, `R9`, `R11`, `R13`, `R24`) used the bounded empty-actions protocol retry. All produced valid non-empty actions after retry, so the real continuation gate remained valid. The deterministic proxy fields present in the public sample rows are paired baseline diagnostics only and were not counted as real continuation evidence.

## Combined Decision

The combined v6 live acceptance is **FAIL** because the independent real judge found one fabrication in 30 samples, yielding `0.9667`, below the required `0.98`. Schema-free omission and real continuation pass their own gates, but they cannot override a failed no-fabrication gate.

Each stage was intentionally run as a separate single-stage runner. Therefore, each raw runner may show a formal top-level `acceptance.status=FAIL` because the other two stages were not requested. This combined report uses the stage-specific aggregate, execution, and coverage fields instead; it does not misclassify those formal partial-runner statuses as additional quality failures.

No new live run is authorized by this report. Before retesting, fix the unsupported test-result insertion, re-run deterministic and semantic audits, and then run a fresh complete real judge stage on the fixed manifest.

Keep `promotionStage: "shadow"`. Do not unlock TF-0075, `liveReady`, `productApproved`, default-on behavior, or critical-only promotion. Provider keys that appeared in chat must be rotated; replacement keys remain environment-only and must not be written to code, reports, summaries, caches, or artifacts.

Machine-readable companion: `artifacts/p6-tf0074-live-acceptance-v6-nemotron-combined-summary.json`.
