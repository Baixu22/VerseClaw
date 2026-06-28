# Real Traffic Shadow MVP

Shadow MVP status: implemented by existing default-off TaskLoop runtime shadow path; Phase B adds no runtime code.

## Existing Minimum Path

The current TaskLoop path can emit `agent_map.prompt_candidate.runtime_shadow` only when both `runtime.agentMap.promptAssemblyExperiment` and `runtime.agentMap.promptCandidateRuntimeShadow` are true and an explicit valid shadow `AgentMapResult` is supplied through `agentMapPromptCandidateRuntimeShadowResult`.

Code evidence:

- `openclaw_runtime/src/agents/task-loop-controller.ts` builds the TaskLoop shadow report only after flags resolve enabled and only from explicit dependency-provided `AgentMapResult`.
- `openclaw_runtime/src/runtime-core/agent-map-prompt-candidate-runtime-shadow.ts` emits diagnostics-only, readonly, in-memory metadata with `candidateTextStored: false`, `candidateTextInsertedIntoPrompt: false`, and no Gateway/provider/model authority.
- `tests/unit/task-loop-controller.test.ts` proves default-off absence, identical reviewer prompt bytes, lifecycle/report emission when enabled, and no candidate sentinel leakage.

## Fields

| Field | Purpose |
|---|---|
| `source` | fixed as `agent_map.prompt_candidate.runtime_shadow` |
| `status` | `disabled`, `success`, `empty`, or `budget_exhausted` |
| `mode` | fixed as `diagnostic` |
| `flags` | records both required gates and aggregate enabled state |
| `runtime` | loop/session/phase/status/iteration/context-pack hash metadata |
| `candidate.contentHash` | proves measurement without storing candidate text |
| `candidate.contentLength` | records size without retaining text |
| `candidate.candidateTextStored` | fixed false |
| `candidate.candidateTextInsertedIntoPrompt` | fixed false |
| `authority.*` | proves no prompt, tool, runtime, Gateway, provider, model, or TaskLoop decision authority |

## Sampling Boundary

Sampling remains internal and explicit. There is no automatic discovery, no background sampler, no service, no listener, no persistent queue, and no production opt-in UI. A caller must provide a valid `AgentMapResult`; the runtime does not build, cache, discover, or reuse one.

## Privacy And Security Boundary

Candidate text is measured but not stored in the shadow report. Reports carry hash, length, counts, diagnostics, and authority metadata only. Shadow output is caller-owned in memory and must not be written to disk, localStorage, indexedDB, electron-store, SQLite, Postgres, MySQL, Redis, Gateway requests, provider transport, model messages, lifecycle default payloads, or checkpoint default payloads.

## Authority Boundary

Shadow output cannot participate in runtime, tool, security, approval, retry, completion, provider, model, Gateway, provider-ordering, or TaskLoop self-check decisions. Legacy prompt construction remains authoritative.

## Verification

- Focused TaskLoop tests prove default-off absence, enabled diagnostic report shape, unchanged reviewer prompt, and sentinel non-leakage.
- Boundary scans prove no renderer direct IPC/Gateway, no service/listener/server additions, no persistence APIs in touched artifacts except proof text, and no transport insertion.
