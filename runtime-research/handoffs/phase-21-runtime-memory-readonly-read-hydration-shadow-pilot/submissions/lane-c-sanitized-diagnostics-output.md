# Lane C Sanitized Diagnostics Output

Verdict: accepted

Evidence:

- Episode projection reuses the Phase 16-20 sanitized readonly inspection primitive.
- Fact projection selects only sanitized column-level fields from `runtime_memory_facts`; it does not select `record_json`.
- Metadata/source/evidence projection sanitizes raw markers and bounds arrays/objects/strings.
- Focused tests poison `record_json` and metadata, then assert serialized output excludes raw task text, self-check, subagent/template markers, stdout/stderr/env/secret/trace markers, provider markers, and runtime authority markers.

Rejected:

- No raw fact/candidate records, raw rows, or durable fact authority are accepted.

Status: accepted
