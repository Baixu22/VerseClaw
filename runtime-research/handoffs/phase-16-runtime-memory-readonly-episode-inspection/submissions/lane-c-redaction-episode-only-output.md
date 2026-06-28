# Lane C: Redaction Episode-Only Output

## Evidence

Inspection output includes only `episodeId`, `taskId`, `kind`, `reference_time`, `boundedSummary`, `sourceRefs`, `evidenceRefs`, `redactionStatus`, optional sanitized metadata, and stats (`episodeCount`, `returned`, `limit`, `truncated`, `inspectedAt`).

The helper selects episode columns directly and does not select `record_json`, facts, candidates, or invalidations. The enabled test manually writes raw markers into `metadata_json` and `record_json`; inspection redacts the metadata value to `[redacted]`, never reads or emits `record_json`, and excludes raw task text, self-check, subagent, template, stdout/stderr, `process.env`, secret, traceparent, transcript/jsonl, toolOutput, fact ids, candidate ids, provider markers, and authority markers.

Raw-retention scan matches are expected negative fixtures/assertions and spec/handoff prohibition text only.

## Accepted Scope

Accepted bounded sanitized episode summary JSON and episode-only statistics.

## Rejected Scope

Raw DB rows, `record_json`, facts, candidates, invalidations, provider context, prompts/transcripts/tool/env/secret/trace markers, and durable runtime authority remain rejected.

## Validation

Focused tests passed in both the single-file persistence run and full Runtime Memory/TaskLoop run. Raw-retention scan was reviewed and showed only negative assertions/prohibition text on the Phase 16 surface.

Status: accepted
