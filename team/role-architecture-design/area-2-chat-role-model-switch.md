# Area 2. Chat-Page Role/Model Switching Separation

## Exploration Log

- **CodeGraph map sections read**: Sections 3 (full: 3.1-3.8), 2.2, 7, 8.
- **CodeGraph tool invocations**: none.
- **Files read beyond the map**:
  - `src/pages/Chat/index.tsx:870-912` — verified `handleSwitchAgent`: persists session state, derives `agent:<agentId>:<sessionId>` key, updates workspace, resets session view. Switching agent = switching sessionKey, confirmed.
  - `src/pages/Chat/ChatInput.tsx:1333-1355` — verified `handleSelectModel` calls `updateAgentModel(currentAgent.id, desiredOverride)` with optimistic UI; the write is persistent per-Agent.
  - `src/stores/chat/runtime-send-actions.ts:31-270` — verified `sendMessage` signature (8 positional params, no modelRef), the `targetAgentId → agent:<id>:main` resolution (`:35-40`), and the `hostApi.chat.sendWithMedia` payload (`:238+`).
  - `shared/host-api/contract.ts:1947-1962` — verified `ChatSendWithMediaPayload` has no model field.
  - `openclaw_runtime/src/gateway/server-methods/chat.ts:3117-3155` — **key finding**: the runtime's `chat.send` params ALREADY accept `thinking?: string` and `fastMode?: boolean` per-turn but no `model`.
  - `openclaw_runtime/src/gateway/server-methods/agent.ts:1090-1130` — **key finding**: the `agent` method ALREADY supports `request.model` / `request.provider` overrides, gated by `allowModelOverride` ("provider/model overrides are not authorized for this caller" otherwise).
  - `openclaw_runtime/src/gateway/server-methods/sessions.ts:192-214` — **key finding**: `SessionEntry` ALREADY has `modelOverride` + `modelOverrideSource` fields, inherited on session fork. A session-level model override concept exists runtime-side (used by CLI-style flows), it is simply unreachable from the Verse Claw chat path.
- **Existing modules found (maturity)**:
  - Agent switch via sessionKey (`handleSwitchAgent`) — production
  - Persistent model switch (`handleSelectModel` → `updateAgentModel` → `agents.updateModel`) — production
  - Runtime per-request model override plumbing (`agent.ts:1111-1112`) — production (gated, unused by chat path)
  - Runtime session `modelOverride` store fields (`sessions.ts:200-203`) — production (unused by chat path)
  - `@` Agent Picker single-message targeting — production
- **Refinement opportunities identified**: model switch is persistent-only; no session/message-level override; send path carries no model; UI bundles agent+model perceptually; sidebar has no role/model grouping.
- **Non-goals and constraints identified**: sessionKey format `agent:<agentId>:<sessionId>` is a hard invariant; `Agent.modelRef` remains the default layer; Renderer/Main boundary; transport policy Main-owned; i18n + E2E rules for UI changes (map §8).

## 1. Current State Summary

**What the existing system CAN do:**

- Switch the acting Assistant (Area 1 taxonomy) with full session-history switching (`index.tsx:872-911`), target another Assistant for one message via `@` picker (`ChatInput.tsx:2560-2604`), and change the current Assistant's *persistent* model (`ChatInput.tsx:1333-1355` → `src/stores/agents.ts:85-89`).
- Runtime-side (unreached by chat): honor a per-request model override in the `agent` method (`agent.ts:1112`) and store a session-level `modelOverride` (`sessions.ts:200`).

**What the existing system CANNOT do:**

- "Send this message with model X" or "use model X for this session only" — every model change rewrites `Agent.modelRef`, silently affecting *all* future sessions of that Assistant and every channel it serves.
- Show the user that role and model are independent axes: the Workspace Actions menu prints `agent.name` + `agent.modelDisplay` on one row (`ChatInput.tsx:2546-2547`), teaching "role = config bundle".
- Record which model produced a given assistant message after an override.

**Why this matters:** the user's report "在对话页面切换角色而不是模型" is precisely this conflation. The decisive discovery is that the runtime already has both override layers built — the missing work is *transport* (renderer → Main → runtime) and *UI separation*, not new runtime concepts.

**Non-goals respected:** sessionKey format untouched (override layers on top of routing); `Agent.modelRef` persistence remains the default tier; renderer keeps the `host-api.ts` single entry.

## 2. Architecture Overview

```
[EXISTING]                                      [NEW]
────────────────────────────────                ────────────────────────────────
ChatInput.tsx                                   Model Picker: 3-tier menu
  Model Picker (persistent only) ────┐            • this message only   (turn)
  @ Agent Picker (msg target)        │            • this session        (session)
  Workspace Actions (agent rows) ────┼────────►   • always for {agent}  (persistent,
                                     │              = existing behavior)
runtime-send-actions.ts              │
  sendMessage(8 positional args) ────┼────────►  sendMessage(text, opts: SendOptions)
                                     │             opts.modelRefOverride?: string
chat contract + chat-api.ts          │
  ChatSendWithMediaPayload ──────────┼────────►  + modelRef?: string (optional field)
                                     │
runtime chat.send params             │           chat.send params + model?: string
  thinking?/fastMode? exist ─────────┼────────►    (forwarded to the agent method's
                                     │              EXISTING request.model override)
runtime agent method                 │
  request.model override [EXISTS] ───┘           sessions.patch modelOverride
runtime SessionEntry                             (session tier reuses EXISTING
  modelOverride field [EXISTS] ─────────────►     SessionEntry.modelOverride)

Transcript message ─────────────────────────►   assistant message metadata gains
                                                  modelRef used (per-turn record)
```

Resolution precedence (top wins): **turn override → session override → `Agent.modelRef` → default model** — each new tier layers above the existing persistent tier without replacing it.

## 3. Component Specifications

### 3.1 Three-tier model selection UI (Model Picker refinement)

**Responsibility:** make the scope of a model change an explicit user choice. The existing picker's option list stays; selecting a model now offers three scopes (concise segmented row or submenu, i18n en/zh/ja/ru):

- **This message** — sets `pendingTurnModelRef` (composer-local state, cleared after send; a small chip appears next to the composer like the `@` target chip).
- **This session** — calls the new session-override path (§3.3); indicator persists in the toolbar while active, with a "reset to agent default" affordance.
- **Always for {agent.name}** — today's exact `handleSelectModel` behavior (`updateAgentModel`), now honestly labeled with its blast radius.

**Internal state:** `pendingTurnModelRef: string | null` in `ChatInput`; session tier state lives runtime-side (SessionEntry), surfaced via session metadata the toolbar already loads.

**Error handling:** turn tier is fire-and-forget local state; session tier failures toast like `composer.modelSwitchFailed` today.

**Workspace Actions menu (design question):** keep agent rows bundled but demote the model text to a muted secondary line labeled with the *source* of the model ("默认模型 · claude-…" vs "会话覆盖 · …"). Splitting into two separate menus is rejected: the agent row legitimately previews what you'd get; the fix is labeling the model as an attribute-with-a-source, not hiding it.

### 3.2 Send-path transport: `modelRef` end to end

**Responsibility:** carry the turn override renderer → runtime.

```typescript
// src/stores/chat/runtime-send-actions.ts — signature refactor
export type SendOptions = {
  attachments?: ...;
  targetAgentId?: string | null;
  knowledgeScope?: WorkspaceKnowledgeScope;
  knowledgeMode?: KnowledgeInvocationMode;
  inputMode?: 'interrupt' | 'guide' | 'queue' | 'revise-goal';
  knowledgeReferences?: ChatKnowledgeReference[];
  activeTaskNodeId?: string | null;
  modelRefOverride?: string;          // [NEW] turn-scoped
};
sendMessage: (text: string, opts?: SendOptions) => Promise<void>;
```

The 8-positional-arg signature is already at its ergonomic limit; adding a 9th positional argument would compound it. The options-object refactor is mechanical (callers: `handleSendMessage` in `index.tsx:1113-1124`, ChatInput's `onSend`).

```typescript
// shared/host-api/contract.ts — additive
export type ChatSendWithMediaPayload = {
  ...existing;
  modelRef?: string;                  // [NEW] optional turn override
};
```

```typescript
// electron/services/chat-api.ts — forward as-is
// runtime chat.send params — additive
{ ...existing, model?: string }       // [NEW] joins thinking?/fastMode? per-turn params
```

Runtime `chat.send` forwards `model` into the `agent` method call, which resolves it through the **existing** `allowModelOverride`-gated `request.model` path (`agent.ts:1111-1112`) — chat-originated internal calls qualify as authorized callers the same way `thinking` already flows. `effectiveModel = modelOverride || baseModel` at `agent.ts:1414` does the rest.

**Per-turn vs session-setting (design question):** both, at their natural layers — the turn override is a stateless request param (mirroring `thinking`); the session override is session state (§3.3). Neither invents a new runtime concept.

**Error handling:** an unknown/unavailable `modelRef` fails model resolution exactly as an invalid `Agent.modelRef` does today — the run errors with the provider message; no partial fallback that would silently use a different model than the user pinned.

### 3.3 Session-level override: expose the existing `SessionEntry.modelOverride`

**Responsibility:** reach the runtime's dormant session override from the chat UI. New gateway-adjacent surface via existing patterns: a `sessions.patchRuntimeModel` host-api method (Main: `sessions-api.ts`, which already owns `patchThinking` — the exact precedent) that patches `modelOverride` + `modelOverrideSource: 'verse-claw-chat'` on the current session entry.

```typescript
// host-api sessions namespace — additive
patchRuntimeModel: (payload: { sessionKey: string; modelRef: string | null }) => HostSuccess;
// modelRef: null clears the override (reset to agent default)
```

Model resolution for a turn then reads: turn param > session `modelOverride` > agent config model — the first two links are new *reads* in the chat path; the storage and inheritance semantics (`sessions.ts:192-214`, forks inherit) already exist.

**Interaction with `@` Agent Picker (design question):** the turn override applies to **the session that executes the turn** — i.e., the target agent's session when `@` is used (the send retargets `sessionKey` before RPC, `runtime-send-actions.ts:85-118`, and the `modelRef` rides the same request). The UI makes this legible: when both an `@` target and a turn model chip are set, the chip renders "via {model} → @{agent}". Session overrides never follow `@` retargeting (they belong to a session, not the composer).

### 3.4 Per-message model provenance (transcript record)

**Responsibility:** record which model served each assistant turn so overrides are inspectable later. The runtime's transcript assistant entries gain `modelRef` (+`modelSource: 'turn' | 'session' | 'agent' | 'default'`) in message metadata at write time — the resolving code knows all four tiers at the moment of resolution. Renderer: `ChatMessage.tsx` shows it in the existing message-details affordance (hover/expand), only when `modelSource !== 'agent'`-or-default, keeping the common case visually quiet.

**Verdict (design question):** recorded, not ephemeral — an override you can't audit later breeds "why did this answer feel different?" confusion, and the cost is one small metadata field.

### 3.5 Sidebar grouping (design question) — defer, add provenance instead

A "by role" or "by model" sidebar grouping mode is **deferred**: sessions are workspace-scoped objects and the existing project/time views (`session-buckets.ts:107-145`) match how a single user actually navigates; a by-model grouping would fragment few sessions across many buckets. The genuinely useful piece — "which model is this session on?" — is delivered cheaper: the session row's secondary label (`Sidebar.tsx:340`, currently agent name) gains the session-override model name when one is active. Grouping modes remain an extension point on `sessionView` if usage proves the need.

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `src/pages/Chat/ChatInput.tsx` | Model picker 3-scope selection; turn chip; source-labeled model line in Workspace Actions rows | §3.1; i18n + E2E per map §8 |
| `src/pages/Chat/index.tsx` | `handleSendMessage` passes `SendOptions`; toolbar session-override indicator | Transport + visibility |
| `src/stores/chat/runtime-send-actions.ts` | `sendMessage` options-object refactor + `modelRefOverride` in RPC payload | §3.2 |
| `src/stores/agents.ts` | NO change (`updateAgentModel` remains the persistent tier) | Constraint honored |
| `shared/host-api/contract.ts` | `ChatSendWithMediaPayload.modelRef?`; `sessions.patchRuntimeModel` | Additive contract |
| `electron/services/chat-api.ts` | Validate + forward `modelRef` to gateway `chat.send` | Thin passthrough |
| `electron/services/sessions-api.ts` | `patchRuntimeModel` (patterned on existing `patchThinking`) | §3.3 |
| Runtime `gateway/server-methods/chat.ts` | Accept `model?` param; forward to agent call; read session `modelOverride` in resolution chain | Joins existing `thinking`/`fastMode` per-turn params |
| Runtime `gateway/server-methods/agent.ts` | NO structural change — existing `request.model` override path is the consumer | Key reuse |
| Runtime `gateway/server-methods/sessions.ts` | NO change to `modelOverride` storage/inheritance | Already built |
| `src/pages/Chat/ChatMessage.tsx` | Render model provenance in message details | §3.4 |
| `src/components/layout/Sidebar.tsx` | Session-override model in secondary label | §3.5 |
| `handleSwitchAgent` (`index.tsx:872`) | NO change | Agent switching untouched |

`ChatInput.tsx` and runtime `chat.ts` are large modules (>20KB): every change is additive (new optional params, new UI branch on the existing picker, no rewrite of send flow or history handling).

## 5. Data Flow

**Scenario: user's Assistant "写作伙伴" defaults to a large model; the user wants one quick turn on a cheap model.**

1. User opens the Model Picker (`chat-model-picker-button`), picks the cheap model, chooses **"仅本条消息"** → `pendingTurnModelRef` set; chip appears in the composer.
2. User sends. `handleSend` (`ChatInput.tsx:1846`) → `onSend(text, { ..., modelRefOverride: pendingTurnModelRef })`; chip state clears.
3. `sendMessage` (`runtime-send-actions.ts`) builds the RPC: `hostApi.chat.sendWithMedia({ sessionKey: 'agent:writer:main', modelRef: 'cheap-model', ... })`. `sessionKey` routing is untouched — the override rides beside it.
4. Main `chat-api.ts` validates `modelRef` is a non-empty string, forwards to `gatewayManager.rpc('chat.send', { ..., model: 'cheap-model' })`.
5. Runtime `chat.send` (`chat.ts:3117`) accepts `model` alongside `thinking`; the internal agent invocation carries `request.model` → `allowModelOverride` path (`agent.ts:1111-1112`) → `effectiveModel = 'cheap-model'` (`:1414`).
6. Assistant reply persisted with metadata `{ modelRef: 'cheap-model', modelSource: 'turn' }`.
7. Next send has no chip → no `modelRef` param → resolution falls to session override (none) → `Agent.modelRef` (large model). `Agent.modelRef` was never written.
8. In the transcript, the one cheap-model reply shows its provenance in message details.

## 6. Migration Path

Purely additive — no shadow/pilot promotion needed, because every new field is optional and every default path is bit-compatible with today:

- No `modelRef` in payload → Main forwards nothing → runtime resolves exactly as now (comms replay parity provable with `pnpm run comms:replay` / `comms:compare`, mandatory here since this touches the send path — map §8 comms-change checklist).
- Session tier uses storage that already exists and already inherits correctly on fork.
- The persistent tier's behavior is unchanged; only its menu label gains honesty.
- Rollback: hide the two new scopes in the picker; dormant contract fields are harmless.
- The one sequencing note: ship the transport (§3.2) and provenance (§3.4) together — an override without a record is the confusing half.

## 7. Design Decisions

1. **Reuse the runtime's existing override layers instead of inventing new ones.** `request.model` (per-turn) and `SessionEntry.modelOverride` (per-session) already exist with authorization gating and fork inheritance; the design is transport + UI. Rejected: a new "model override service" or session-metadata sidecar in Main — would duplicate runtime state and drift.
2. **Options-object refactor for `sendMessage`.** Nine positional params is unmaintainable; the refactor is contained (two call sites). Rejected: appending positionally (compounds the existing readability debt at its worst point).
3. **Three explicit scopes over a "smart" default.** Making the picker default to session-scope (arguably the user's intuitive expectation) would silently change existing muscle memory for persistent switching. Explicit scope selection teaches the mental model this whole area is about. Extension point: a settings preference for the picker's default scope.
4. **Provenance recorded per message.** See §3.4. Rejected: ephemeral overrides (unauditable).
5. **Sidebar grouping deferred; provenance label instead.** See §3.5.
6. **`@` + turn-override composition defined as "override follows the executing session".** The alternative (override applies only to the current agent, ignored on `@` retarget) creates a send whose visible chips lie about what will happen.

## 8. Validation Approach

- **Comms replay parity**: no-override sends byte-identical to baseline (`comms:compare`).
- **Unit**: resolution precedence table (turn > session > agent > default) across all 8 presence combinations; `patchRuntimeModel` null-clears; fork inherits session override (existing runtime behavior, now asserted from the chat path).
- **E2E (Playwright, per map §8)**: pick "this message" → send → message details show turn provenance → next send uses agent model; set session override → toolbar indicator + sidebar label appear → reset clears both; `@` target + turn chip → override lands on target's session.
- **Failure experiment**: turn override naming an unconfigured model → run errors visibly, `Agent.modelRef` untouched afterward.
- **Success metric**: `agents.updateModel` call frequency from the chat page drops (persistent writes were the only option; most were probably meant as session/turn choices) — observable in existing telemetry/audit if enabled, else in E2E behavioral review.

## 9. Boundary Considerations

- **sessionKey invariant**: untouched — `modelRef` is a payload sibling, never encoded into the key; all parsers (`sessions-api.ts` `parseSessionKey`, `session-buckets.ts:5-7`) unaffected.
- **Renderer/Main boundary**: all new calls flow through `hostApi.chat` / `hostApi.sessions`; no direct gateway access from the renderer.
- **Runtime authorization boundary**: the `allowModelOverride` gate (`agent.ts:1090-1112`) remains the enforcement point — chat-originated overrides pass through it as authorized internal callers, and unauthorized external callers stay rejected exactly as today.
- **`Agent.modelRef` write boundary**: only the explicit "always for {agent}" scope writes it; the two new tiers cannot mutate agent config by construction.
- **New boundary introduced**: turn/session overrides select among *configured* models only (picker lists `modelOptions` as today) — no free-text model refs from the composer, so the override path cannot reach providers the user hasn't set up.
