# Lane D: Output Redaction CLI Proof

## Evidence

- Utility tests create an explicit existing Runtime Memory database, insert one sanitized episode, poison stored raw columns/metadata with forbidden markers, and invoke JSON and text utility output.
- The tests assert returned JSON/text contain only sanitized episode summaries/statistics and redacted metadata, while excluding `record_json`, raw task, self-check, subagent/template/tool/env/secret/trace markers, facts, candidates, provider markers, and runtime authority markers.
- The tests compare persistence table counts before and after utility execution.

## Accepted Scope

Accepted sanitized episode summaries/statistics in JSON and text for explicit existing databases only.

## Rejected Scope

Rejected raw rows, `record_json`, transcript/chat/jsonl/trace/prompt/payload/checkpoint/tool/env/secret output, fact/candidate output, provider context, and runtime authority.

## Validation

Pending final validation synthesis.

## Status

Status: accepted
