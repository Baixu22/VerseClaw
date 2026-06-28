# Lane D: Output Redaction Command Proof

## Evidence

- Direct utility tests poison `metadata_json` and `record_json` with raw task, self-check, subagent/template/tool/env/secret/trace, provider, facts/candidates, and runtime-authority markers.
- Package command tests poison `metadata_json` and `record_json` with raw task, jsonl, prompt, payload, checkpoint, tool output, secret, trace, provider, facts/candidates, and runtime-authority markers.
- JSON and text assertions verify sanitized summaries/statistics only and no `record_json` or raw markers.

## Accepted Scope

Accepted sanitized episode summaries/statistics output for explicit existing databases.

## Rejected Scope

Rejected raw chat/transcript/jsonl/trace/prompt/payload/checkpoint/tool args/tool output/env/secret/raw row/`record_json`, facts, candidates, provider context, and runtime-authority output.

## Validation

Synthesis owner rechecked JSON/text command output tests and raw-retention scan results.

## Status

Status: accepted
