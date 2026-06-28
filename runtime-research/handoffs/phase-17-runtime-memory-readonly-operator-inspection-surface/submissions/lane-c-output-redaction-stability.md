# Lane C: Output Redaction Stability

## Evidence

- Tests mutate `metadata_json` and `record_json` with raw markers, then assert the inspection output includes sanitized safe metadata only and excludes raw markers.
- Source returns the Phase 16 sanitized episode result shape.

## Accepted Scope

Output may include episode id, task id, kind, reference_time, boundedSummary, source/evidence refs, redaction status, safe metadata, stats, and bounded diagnostics.

## Rejected Scope

No raw rows, `record_json`, facts, candidates, invalidations, provider context, raw task/tool/env/secret/trace data, or runtime authority output is accepted.

## Validation

Pending final synthesis validation.

## Status

Status: needs_revision
