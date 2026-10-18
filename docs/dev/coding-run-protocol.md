# CodingRun JSONL Protocol v1

Status: display/CI interchange contract, not a runtime state machine.

## Version and compatibility

Every line is a JSON object with `schema`, `sequence`, `recordType` and
`payload`. The first record is always `coding-run` with sequence `0`; later
records are explicit evidence events. The current schema string is
`coding-run/v1`.

Compatibility policy:

- Consumers must reject an unknown `schema`; they must not silently reinterpret
  a future version.
- Unknown fields are invalid in v1. Additive fields require a version decision
  and a fixture update, not best-effort parsing.
- Missing required fields, malformed JSON, unknown record types and non-monotonic
  sequence numbers fail closed.
- A null/empty association means the owner did not supply it; it never means
  a guessed default. Session keys do not establish workspace scope or lineage.
- The serializer is in-memory/display-only. It does not write files or create a
  second trace, task, attempt or permission authority.

## Record mapping

| `recordType` | Source and meaning |
| --- | --- |
| `coding-run` | Read-only projection of the existing run/task/session/trace owners. |
| `run` | Warning or projection marker for existing execution attempts. |
| `turn` | Existing turn/session outcome; never a task completion authority by itself. |
| `item` | Existing message, tool or artifact item status. |
| `approval` | Existing approval decision reference. |
| `file` | Existing file operation reference. |
| `test` | Existing test command/status reference. |
| `verification` | Existing verification result and its explicit authority. |
| `loop` | Existing Task Loop lifecycle projection; missing evidence is warned. |

## Difference from Codex exec

This is not a Codex CLI compatibility layer. It does not implement Codex exec's
streaming terminal protocol, multi-turn agent loop, tool-call control plane or
CLI-specific exit semantics. It exports the same underlying ClawX facts in a
small versioned JSONL envelope that CI can parse with
`scripts/coding-run-summary.mjs`.

## CI consumption

```bash
node scripts/coding-run-summary.mjs path/to/coding-run.jsonl
```

The script exits `0` with a JSON summary for a valid v1 stream and exits `1` with
a structured schema error for invalid input. It is agent-driven evidence, not a
claim that every existing runtime path has been migrated to this protocol.
