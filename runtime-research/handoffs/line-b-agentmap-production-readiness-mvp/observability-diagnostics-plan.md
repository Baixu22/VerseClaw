# Observability Diagnostics MVP

Diagnostics are audit and observability evidence only. They do not create runtime, prompt, tool, security, approval, retry, completion, provider, model, Gateway, or provider-ordering authority.

## Stable Field Mapping

| MVP Field | Existing Evidence |
|---|---|
| `inserted` | `candidate_inserted`, `status: inserted`, `insertedIntoTaskLoopPilotSurface: true` |
| `blocked` | `status: legacy`, `failClosed: true`, gate/input/budget diagnostics |
| `fail_closed` | `metadata.failClosed: true`, `legacyReviewerPromptByteIdentical: true` |
| `budget_exhausted` | `candidate_budget_exhausted` and `status: budget_exhausted` |
| `prompt_present_excluded` | `prompt_present_file_excluded` and `promptPresentExcludedCount` |
| `invalid_result` | `invalid_agent_map_result` |
| `gate_disabled` | `gate_disabled` |
| `invocation_not_requested` | `invocation_not_requested` |

## Shadow Diagnostics Fields

- `source`
- `status`
- `mode`
- `flags`
- `runtime`
- `candidate.contentHash`
- `candidate.contentLength`
- `candidate.includedSymbolCount`
- `candidate.includedFileCount`
- `candidate.promptPresentExcludedCount`
- `candidate.candidateTextStored`
- `candidate.candidateTextInsertedIntoPrompt`
- `authority`
- `diagnostics`
- `evidenceRefs`

## Plan-Only Future Aggregation

A later task may add internal aggregation, but it must remain default-off, diagnostics-only, in-memory or explicitly caller-owned, and non-authoritative. Any persistence or UI requires a separate task spec, synthesis, and validation.
