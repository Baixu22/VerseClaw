# Internal Optimization

Status: diagnostics_only_internal_optimization.

## Sanitizer Hardening

The sanitizer now classifies these leak classes:

- `raw`: prompt, provider payload, tool args/results, stdout/stderr, raw chat, message content, workspace content
- `secret`: API keys, authorization values, bearer tokens, passwords, GitHub/OpenAI-like tokens
- `path`: Windows paths and POSIX user/workspace/temp paths
- `env`: env-like key/value pairs and known provider token variable names

Reports that contain these leak classes are not acceptable continuation evidence.

## Transcript Parser Hardening

The offline parser now tracks:

- malformed JSONL parse errors
- tool observations including `code_mode_exec`
- unknown-name tool observations
- candidate metadata
- partial signal counts
- usage metadata present vs missing
- would-block and would-allow shadow outcomes

The parser still emits only hashed refs, counts, rates, normalized tool/candidate metadata, and signal counts. It does not retain raw prompt, provider payload, tool args/results, stdout/stderr, env, path, secret, or workspace content.

## Real-Data Feedback Target

Current real-data quality remains 8/15 warning from the previous baseline.

The next verifiable target is 12+/15, requiring sanitized records with:

- high parse success
- mutation-capable tool observations
- `destructive_operation_guard` candidate metadata
- both would-block and would-allow shadow outcome counts
- usage metadata when present, with missing usage counted rather than inferred

No real-data score is fabricated in this phase.

