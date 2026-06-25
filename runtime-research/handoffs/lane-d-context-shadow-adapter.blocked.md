# lane-d-context-shadow-adapter: blocked_on_lane_a_contracts

## Scope

- Lane: `lane-d-context-shadow-adapter`
- Goal: convert existing context sources into `ContextItem` shadow output without changing prompt/context input.
- Status: `blocked_on_lane_a_contracts`
- Blocking dependency: `lane-a-runtime-core-contracts` must provide the canonical runtime-core exports for `RuntimeTaskEvent`, `ContextItem`, `ToolCallRequest`, `ToolCallResult`, `EvidenceRef`, and `Checkpoint`.

## Contract Search

Commands run:

- `rtk rg -n "export (type|interface|const).*ContextItem|type ContextItem|interface ContextItem|ContextItemSchema|RuntimeTaskEvent|ToolCallRequest|ToolCallResult" openclaw_runtime shared src electron runtime-research harness -g "*.ts" -g "*.md" -S`
- `rtk rg --files . | rtk rg "runtime-core|contracts|lane-a|context.*contract|task-event|evidence"`
- `rtk rg -n "ContextItem|context item|context provider|LoopContextPack|context section|evidence/context" runtime-research openclaw_runtime/src/agents/loop-context-pack.ts openclaw_runtime/src/agents/task-loop-context.ts openclaw_runtime/src/context-engine -S`

Findings:

- No implementation-owned canonical `ContextItem` export was found under `openclaw_runtime`, `shared`, `src`, or `electron`.
- `runtime-research/agent-runtime-core-spec.md` describes `ContextItem` conceptually, but it is not an importable contract.
- `runtime-research/handoffs/phase-1-runtime-surface-inventory/synthesis.md` already records that `ContextItem`, `RuntimeTaskEvent`, `ToolCallRequest`, `ToolCallResult`, `EvidenceRef`, and `Checkpoint` are absent and should be added by the Stage 1 contract layer.
- Existing `LoopContextPackItem` carries useful legacy metadata (`id`, `text`, `source`, `estimatedTokens`, `truncated`, `omitted`, `priority`) but must not become a parallel runtime-core `ContextItem` type.

## Existing Seam

Primary legacy paths:

- `openclaw_runtime/src/context-engine/types.ts`
- `openclaw_runtime/src/context-engine/legacy.ts`
- `openclaw_runtime/src/agents/loop-context-pack.ts`
- `openclaw_runtime/src/agents/task-loop-context.ts`

Current behavior:

- `LegacyContextEngine.assemble()` is a pass-through. It returns the same `messages` array and `estimatedTokens: 0`; caller-owned legacy assembly still handles prompt shaping.
- `buildLoopContextPack()` builds bounded sections in stable priority order and already records source, rough token estimate, truncation, and omitted item metadata on `LoopContextPackItem`.
- `formatLoopContextPackForPrompt()` is the prompt-affecting renderer. Any future shadow output must not be read by this formatter.
- `buildTaskLoopContextPack()` embeds the `LoopContextPack` and separately formats evidence text for the reviewer prompt.

## Do Not Implement Yet

Do not add a local `ContextItem` interface, schema, or `runtime-core` type file in this lane. That would create a parallel contract and violate the lane dependency rule.

Do not add AgentMap ranking or provider ordering. This lane is only a provider/item shadow adapter once lane-a contracts exist.

Do not alter `LegacyContextEngine.assemble()`, `formatLoopContextPackForPrompt()`, or `formatTaskLoopContextPackForReviewer()` behavior while blocked.

## Adapter Plan After Lane A

Once lane-a exports canonical `ContextItem`, add a shadow adapter that imports that type from the lane-a contract source and maps legacy pack items without changing prompt text.

Suggested feature flags:

- `runtime.contextProviders.shadow`
- `runtime.contextProviders.loopPackShadow`

Suggested mapping:

| Legacy source | Future `ContextItem` fields |
|---|---|
| `LoopContextPackSection.id` | provider/source kind such as `loopContextPack.section` |
| `LoopContextPackItem.id` | stable source id, prefixed with pack hash/session/loop when available |
| `LoopContextPackItem.source` | source kind/source label |
| `LoopContextPackItem.text` | item content |
| `LoopContextPackItem.estimatedTokens` | token estimate |
| `LoopContextPackItem.text.length` | char length |
| `LoopContextPackItem.truncated` and `omitted` | truncation/omission metadata |
| `TaskLoopContextPack.evidenceText` | evidence/context section item, source kind `taskLoop.evidence`, untrusted |

Minimal future code seam:

- Add a helper beside `buildLoopContextPack()` that derives `ContextItem[]` from an already-built `LoopContextPack`.
- Add an optional shadow field to `LoopContextPack` only when the canonical `ContextItem` type is importable and `runtime.contextProviders.loopPackShadow` is enabled.
- Add an optional shadow field to `TaskLoopContextPack` for evidence/context sections only when `runtime.contextProviders.shadow` is enabled.
- Keep existing prompt formatters byte-stable and independent from shadow fields.

## Test Draft

Executable tests should wait for lane-a contracts. Draft assertions:

- `flag off keeps LoopContextPack output stable`
  - Build the same `LoopContextPack` fixture with shadow flags absent/false.
  - Assert deep equality against the current pack shape and exact `formatLoopContextPackForPrompt()` text.

- `loopPackShadow emits ContextItem metadata without prompt changes`
  - Enable `runtime.contextProviders.loopPackShadow`.
  - Assert every emitted item has canonical `ContextItem` shape from lane-a, source id, source kind, token estimate or char length, and truncation metadata.
  - Assert `formatLoopContextPackForPrompt(packWithShadow) === formatLoopContextPackForPrompt(packWithoutShadow)`.

- `shadow ContextItem can represent evidence/context section`
  - Build `TaskLoopContextPack` with `evidenceRefs` and `subagentEvidence`.
  - Enable `runtime.contextProviders.shadow`.
  - Assert evidence text is represented as untrusted context/evidence item metadata.
  - Assert `formatTaskLoopContextPackForReviewer()` output is unchanged with the flag on.

- `LegacyContextEngine flag off/on does not change model messages`
  - Assemble with `LegacyContextEngine` using a fixed `AgentMessage[]`.
  - Assert returned `messages` identity/order/content stays unchanged with the shadow flags off and on.
  - Assert any shadow diagnostics are side-channel only and not part of model prompt input.

## Acceptance Once Unblocked

- The only imported `ContextItem` type comes from `lane-a-runtime-core-contracts`.
- Flag off behavior is exactly legacy behavior.
- Flag on adds only side-channel shadow items and does not alter prompt text, message arrays, section ordering, hashes used by legacy behavior, or ranking.
- No AgentMap ranking, provider registry cutover, or prompt assembly ownership migration is introduced in this lane.
