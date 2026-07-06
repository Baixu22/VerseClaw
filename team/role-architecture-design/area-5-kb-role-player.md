# Area 5. Knowledge-Base Role Player Optimization

## Exploration Log

- **CodeGraph map sections read**: Sections 6 (full: 6.1-6.8), 2.4, 7, 8.
- **CodeGraph tool invocations**: none.
- **Files read beyond the map**:
  - `electron/services/knowledge-api.ts:180-300` — verified `DEFAULT_STEWARD_CONFIG` hardcoded constant, `canApplyDirectly: false`, and the JSON/JSONL directory layout (`drafts/`, `inbox/`, `proposals/`, `provenance/`, `audit.jsonl`).
  - `electron/services/knowledge-api.ts:600-668` — verified `classifyDraft` (regex CN/EN keyword classification into decision/architecture/command/troubleshooting/glossary/procedure/source-note/synthesis) and `stewardReviewDraft` (tags + 3 heuristic warnings + fixed advisory note).
  - `electron/services/knowledge-api.ts:2000-2060` — verified `stewardReview` host route: reads draft, runs heuristic review, persists `status: 'steward_reviewed'` + `stewardNotes` + audit line, returns `config: DEFAULT_STEWARD_CONFIG`. Also `applyReviewedChange` (`:1983-2019`): the ONLY wiki write path, `wiki.apply` with `status: 'draft'`, user-confirmation-gated.
  - `shared/host-api/contract.ts:2290-2319` — verified `KnowledgeStewardConfig` with `canApplyDirectly: false` as a *literal type* (not `boolean`) — the boundary is enforced at the type level; and `KnowledgeCreateDraftPayload.agentId?: string | null`.
  - `electron/services/chat-api.ts:128-220` — verified KB injection trio: `applyKnowledgeMetadata` (read-only instruction block, denied actions list), `readSelectedKnowledgeReferences` (auto-read ≤5 refs via `wiki.get`, 600-char citations), `applyKnowledgeReadCitations`.
  - `openclaw_runtime/src/agents/role-contract.ts:230-359` — confirmed `knowledge-steward` absent from `BUILT_IN_ROLE_CONTRACTS`.
- **Existing modules found (maturity)**:
  - Steward heuristic review + audit (`knowledge-api.ts:615-658, 2021-2045`) — **production**
  - KB injection path (`chat-api.ts:128-220`) — **production**
  - `/steward`, `/steward-audit` slash commands + "Ask Steward" button — **production**
  - `KnowledgeStewardConfig` type with literal-false apply — **production**
  - 5 workbench tabs incl. `governance` — **production**
  - LLM-involved steward classification — **absent (planned by this design)**
- **Refinement opportunities identified** (map §6.8 + exploration): hardcoded steward config; regex-only classification; steward outside the RoleContract registry; steward opinions not carried into chat context; `agentId` scope-filter not linked to role names.
- **Non-goals and constraints identified**: KB is NOT vector RAG, NOT an Obsidian clone, NOT an autonomous agent writer (design-overview §1.2); `canApplyDirectly: false` boundary must stay (it is a literal type — good); JSON/JSONL persistence is fixed; Knowledge Hub does not replace role memory.

## 1. Current State Summary

**What the existing system CAN do:**

- Run an advisory Steward over drafts: classify by regex (`knowledge-api.ts:615-625`), tag, warn (missing sources / short body / unresolved language, `:648-651`), persist review state + audit (`:2030-2043`), all without ever writing to the wiki (`applyReviewedChange` at `:1983` is the sole write path, user-confirmed).
- Inject selected KB references into chat with read-only discipline (`chat-api.ts:128-220`), including auto-read citations.
- Scope KB entries by `workspaceId`/`agentId` (`contract.ts:2308-2319`).

**What the existing system CANNOT do:**

- Configure the Steward at all: `DEFAULT_STEWARD_CONFIG` is a constant; `stewardReview` returns it verbatim (`:2044`). No second steward variant, no capability tuning, no scope change.
- Reason semantically: a draft about "为什么我们放弃了 monorepo" classifies by whichever regex fires first, not by meaning; conflict/duplicate detection against existing pages is absent.
- Speak in conversation: steward `warnings` and `stewardNotes` are persisted on drafts but the chat injection path never carries them, so the model can cite a page the Steward flagged as stale/conflicting without knowing.
- Bind KB slices to orchestration roles: `agentId` filters by Agent (Assistant, per Area 1 taxonomy), never by RoleContract name.

**Why this matters:** the Steward is the KB's only "role player", and it is currently a set of regexes wearing a role name. For a personal knowledge workflow, the value of a steward is judgment (is this a duplicate? does it contradict page X?) and voice (warning the user *at the moment of use*). Both are missing.

**Non-goals respected:** no vector DB; no autonomous writes (`canApplyDirectly: false` untouched — the literal type stays); wiki remains user-review-gated; JSON/JSONL persistence unchanged.

## 2. Architecture Overview

```
[EXISTING]                                       [NEW]
────────────────────────────────                 ────────────────────────────────
knowledge-api.ts                                 KB Role Config (file-backed)
  DEFAULT_STEWARD_CONFIG ───────────┐              knowledge/steward-roles.json
  classifyDraft (regex)             │              (variants: steward/curator/...;
  stewardReviewDraft                ├──────────►    capabilities within the same
  stewardReview host route          │               literal-false apply ceiling)
  applyReviewedChange (only write)  │
                                    │            Semantic Steward pass (opt-in)
chat-api.ts                         │              steward LLM classification via
  applyKnowledgeMetadata ───────────┼──────────►    a `knowledge-steward`
  readSelectedKnowledgeReferences   │               RoleContract registered in
  applyKnowledgeReadCitations ──────┤               cfg.agents.roles[] (read-only
                                    │               tools, network none)
role-contract.ts                    │
  BUILT_IN_ROLE_CONTRACTS ──────────┤            Steward Notes injection
  (steward NOT added here)          │              applyKnowledgeStewardNotes
                                    │              (3rd metadata block: warnings/
role-spawn.ts                       ├──────────►    freshness/conflict opinions
  spawnRoleSubagent ────────────────┘               for the refs in this turn)

Knowledge page: 5 tabs                           review tab: steward queue section
  library/inbox/drafts/review/governance           (no new tab)
```

## 3. Component Specifications

### 3.1 KB Role Config [NEW] — config-driven steward variants

**Responsibility:** replace the hardcoded constant with a file-backed registry of KB-bound role players, defaulting to today's exact steward. Lives at `<OpenClaw config dir>/knowledge/steward-roles.json` — KB-local, next to the data it governs (consistent with the existing `watched-directories.json` pattern at the same level), not electron-store (it is knowledge-domain state, not app state) and not OpenClaw runtime config (the Steward executes in Main).

**Interfaces:**

```typescript
// shared/host-api/contract.ts — evolves KnowledgeStewardConfig additively
export type KnowledgeRolePlayerConfig = KnowledgeStewardConfig & {
  displayName?: string;
  description?: string;
  classification?: 'heuristic' | 'semantic';     // default 'heuristic'
  reviewFocus?: Array<'classification' | 'duplicates' | 'freshness' | 'conflicts'>;
  contractRef?: string;                          // optional RoleContract name for semantic pass (§3.2)
};

export type KnowledgeRoleRegistryFile = {
  version: 1;
  defaultRoleId: string;                         // 'knowledge-steward'
  roles: KnowledgeRolePlayerConfig[];
};
```

Note `capabilities.canApplyDirectly` remains the literal type `false` — a variant *cannot* be configured to write. Variants differ in focus and classification mode: e.g. `knowledge-curator` (reviewFocus: duplicates+freshness, suggests merges), `knowledge-critic` (reviewFocus: conflicts, stricter warnings). Custom user variants are just more entries; validation rejects entries missing `roleId` or attempting non-false apply (JSON parse-level check since the type can't express it for hand-edited files).

**Internal state:** the JSON file; loaded lazily with the same read-or-default pattern as watched-directories. Missing/corrupt file → registry containing exactly `DEFAULT_STEWARD_CONFIG` (today's behavior).

**Lifecycle:** read on first steward operation per process; `knowledge.configure`-style host route (`knowledge.stewardConfig.get/update`) exposes it to a small settings surface on the Knowledge page's existing Configure flow. **Error handling:** any load error → hardcoded default; write validation errors returned in the standard HostSuccess envelope.

### 3.2 Semantic Steward pass [NEW, opt-in] — LLM classification through the role system

**Responsibility:** when a KB role player has `classification: 'semantic'`, `stewardReviewDraft` gains a second pass: the heuristic pass runs first (unchanged, instant, offline-safe), then an LLM pass refines type/tags and adds judgment warnings (probable duplicate of page X, contradicts page Y, stale claim).

**How it connects to the role system (the registration question):** register `knowledge-steward` as a **config-defined RoleContract** in `cfg.agents.roles[]` — NOT in `BUILT_IN_ROLE_CONTRACTS`. Rationale: the built-in list is the software-dev orchestration core consumed by the router's supporting-role lists (`role-router.ts:103-107`) and team templates; inserting steward there would make it routable/spawnable in dev orchestrations where it doesn't belong. The config path gives it everything the map's opportunity #3 asks for — tool whitelist, model binding, effort, permissions via `spawnRoleSubagent` — because `resolveRoleContract` resolves config roles identically (`role-registry.ts:93-101`). Verse Claw ships the contract definition and writes it into config during KB init (`knowledge.init`), same as any role pack (Area 3 §3.5).

**The contract:**

```typescript
// authored as config entry, resolved by role-registry.ts
{
  name: 'knowledge-steward',
  displayName: 'Knowledge Steward',
  rolePrompt: 'Review knowledge drafts for classification, duplicates, freshness, and conflicts. You advise; you never write. Output structured review JSON only.',
  tools: ['read'],                                    // no write/edit/bash — hard allowlist
  permissions: { filesystem: 'read', network: 'none', commands: [] },
  model: { default: null, fallback: [] },             // inherits; user can pin a cheap model
  effort: 'low',
  outputSchema: { format: 'json', jsonSchema: StewardReviewSchema },
  handoff: { to: [], from: [] },
  tags: ['knowledge', 'advisory'],
}
```

**Execution path:** Main's `stewardReview` gathers context (draft + top-K `wiki.search` results for the draft title/tags — existing RPC, no vector index) and invokes the runtime via the existing subagent path (`spawnRoleSubagent` with the steward contract, `mode: isolated`, short timeout), or — cheaper first increment — a direct single-turn `chat.send` against a dedicated steward session with the compiled contract SOUL as system prompt. The design specifies the role-spawn path as the target (it enforces the tool allowlist mechanically) and permits the single-turn path as the MVP.

**Structured output:**

```typescript
type StewardSemanticReview = {
  type: KnowledgeDraftType;
  tags: string[];
  warnings: Array<{ kind: 'duplicate' | 'conflict' | 'stale' | 'quality'; message: string; relatedPageId?: string }>;
  confidence: number;      // 0-1; below threshold → keep heuristic result, log disagreement
};
```

**Slash commands:** `/steward` and `/steward-audit` (`ChatInput.tsx:138-150`) keep their signatures; when the active role player is semantic, results simply carry richer warnings. No UI contract change.

**Error handling:** LLM pass failure/timeout → heuristic result stands, `stewardNotes` records "semantic pass unavailable". The Steward must degrade to today's behavior offline.

### 3.3 Steward Notes injection [NEW] — letting the Steward speak in conversation

**Responsibility:** extend the chat KB injection with a third metadata block carrying the Steward's persisted opinions about the references actually attached this turn. Shape mirrors the existing two blocks (`applyKnowledgeMetadata`, `applyKnowledgeReadCitations`) — a capped, untrusted-metadata JSON block:

```typescript
// electron/services/chat-api.ts [NEW fn, same pattern]
function applyKnowledgeStewardNotes(
  message: string,
  notes: Array<{
    referenceId: string;
    roleId: string;                      // which steward variant produced it
    warnings: string[];                  // from draft.warnings / review records
    reviewStatus?: 'steward_reviewed' | 'unreviewed';
    suggestion?: 'merge' | 'archive' | null;
  }>,
): string;
// budget: CONTEXT_FRAGMENT_LIMITS.knowledgeStewardNotesChars = 2_000
// instruction: "Advisory steward notes about the attached references. Consider the
// warnings when citing; do not modify knowledge because of these notes."
```

**Where notes come from:** for each `NormalizedKnowledgeReference` in the send, Main looks up the page/draft's persisted review artifacts (drafts carry `warnings`/`stewardNotes` after `stewardReview`; provenance records carry freshness). No LLM call at send time — injection reads only persisted state, keeping the chat send path fast and offline-safe.

**Why a metadata block, not a context provider:** the KB injection already lives in Main's `chat-api.ts` as message-prepended blocks; the runtime context engine never sees KB data. Adding a runtime-side provider for steward notes would split KB context across two layers and violate the established ownership (Knowledge Hub is a Verse Claw product layer, design-overview §1.2/§8.6). Consistency wins.

**Error handling:** lookup failure for any reference → skip that reference's notes; empty notes → no block (zero overhead for non-KB turns).

### 3.4 Role↔KB slice binding (the `agentId` question) — scope by role tags, not identity rewiring

**Verdict:** do NOT overload `agentId` with RoleContract names — per Area 1's taxonomy those are different kinds (`agentId` names an Assistant; RoleContract names a library item), and conflating them in a persisted field would re-create exactly the ambiguity Area 1 removes. Instead, add an optional additive field:

```typescript
// contract.ts KB entry types — additive
roleTags?: string[];   // RoleContract names this entry is especially relevant to
```

Consumers: (a) KB search/list accept a `roleTag` filter; (b) when a role-spawned subagent's turn triggers KB routing (`shouldRouteKnowledge`), entries matching the spawned role's name rank first. This delivers "each role sees its slice" as *relevance shaping*, not access control — per-role vaults/ACLs are rejected because the KB is a single user's wiki; partitioning it into per-role silos with access control adds multi-tenant machinery to a single-tenant product (off-spec for the project identity). Alignment note: `roleTags` deliberately reuses the Role Memory binding vocabulary (`MemoryCard.roleTags`, Area 4), so "role-scoped knowledge" means one thing across both systems.

### 3.5 Workbench surface — review tab section, not a sixth tab

The Steward's queue (drafts in `steward_reviewed` status awaiting user decision, plus pending merge/archive suggestions) surfaces as a section within the existing `review` tab, with per-item steward attribution (which variant, which warnings). The `governance` tab keeps its role as the audit/health view and gains steward activity lines it already receives via `audit.jsonl` (`appendAudit({ type: 'steward_reviewed', ... })` exists today). A dedicated steward tab is rejected: the workbench's 5 tabs map to workflow stages, and steward output is an input *to* the review stage, not a stage of its own.

## 4. Integration Plan

| Existing Module | Change Required | Rationale |
|---|---|---|
| `electron/services/knowledge-api.ts` | Load role registry file (fallback = current constant); `stewardReview` accepts `roleId`, runs optional semantic pass; new `stewardConfig.get/update` routes | Config-driven variants; §3.1-3.2 |
| `shared/host-api/contract.ts` | `KnowledgeRolePlayerConfig` (extends `KnowledgeStewardConfig`), `roleTags?` on KB entry payloads, steward-config routes | Typed surface; `canApplyDirectly: false` literal preserved |
| `electron/services/chat-api.ts` | Add `applyKnowledgeStewardNotes` alongside the existing two blocks + `knowledgeStewardNotesChars` limit | Steward voice in conversation |
| `openclaw_runtime/src/agents/role-contract.ts` | NO change — steward NOT added to built-ins | Keep dev-core registry stable |
| Steward RoleContract config entry (written by `knowledge.init`) | NEW config data | Role-spawn capabilities via existing registry |
| `openclaw_runtime/src/agents/role-spawn.ts` | NO change | Already spawns any registered contract |
| `src/pages/Knowledge/index.tsx` | Review-tab steward section; Configure flow gains variant management | §3.5; i18n en/zh/ja/ru per map §8 |
| `src/pages/Chat/ChatInput.tsx` | NO signature change to `/steward`, `/steward-audit` | Commands stable |
| `electron/services/workspace-permissions.ts` | NO change | Steward semantic pass rides `chat.send`/subagent paths already classified |
| `shared/i18n/locales/*/knowledge.json` | Variant labels, steward-note strings | i18n rule |

`knowledge-api.ts` is 2353 lines (>20KB): changes are additive — a registry loader, an optional second pass appended after the existing heuristic body, and two new routes; `classifyDraft`/`stewardReviewDraft` bodies are not rewritten (heuristic remains pass one).

## 5. Data Flow

**Scenario: user saves a chat insight with `/save`, the semantic Steward reviews it, and the warning surfaces in a later conversation.**

1. `/save` → draft created via `knowledge.createDraft` (`knowledge-api.ts`), status `pending`.
2. User (or the draft flow) triggers `/steward` → `hostApi.knowledge.stewardReview({ draftId, roleId: 'knowledge-steward' })`.
3. [CHANGED] `stewardReview` loads the role registry; the default steward has `classification: 'semantic'` (user opted in). Pass 1: existing heuristic (`stewardReviewDraft`) → type/tags/basic warnings. Pass 2: Main gathers top-5 `wiki.search` hits for the draft title, spawns the `knowledge-steward` contract via `spawnRoleSubagent` (tools=[read], network=none, effort=low, JSON schema output) → returns `{ type: 'decision', warnings: [{ kind: 'conflict', message: '与 "迁移方案" 页的双写结论冲突', relatedPageId: 'p_123' }], confidence: 0.86 }`.
4. Draft persisted with merged review (`status: 'steward_reviewed'`, warnings from both passes), audit line appended — same write path as today (`knowledge-api.ts:2030-2043`).
5. Review tab's [NEW] steward section shows the draft with the conflict warning; the user resolves it and confirms apply → `applyReviewedChange` → `wiki.apply` (`:1983-2019`) — the ONLY write, unchanged.
6. A week later the user asks about migration; KB routing attaches the related wiki page as a reference. `chat-api.ts` builds the send: `applyKnowledgeMetadata` block, `readSelectedKnowledgeReferences` citations, and [NEW] `applyKnowledgeStewardNotes` block carrying the persisted conflict note for that page.
7. The model answers citing the page *and* flags the recorded conflict — the Steward has spoken in conversation without any turn-time LLM call.

## 6. Migration Path

The semantic pass changes advisory output quality, so it follows the pilot pattern; everything else is additive:

- **Fresh spec**: `harness/specs/tasks/knowledge-steward-semantic-pilot.md`.
- **Operator gate / default-off**: registry ships with `classification: 'heuristic'` for the default steward; semantic is per-variant opt-in via the Configure flow.
- **Shadow phase**: with semantic enabled in shadow, both passes run but the *heuristic* result remains authoritative; the semantic result is stored as `stewardNotes` appendix + disagreement log. Telemetry: type-classification agreement rate, warning precision (user marks warnings helpful/unhelpful during review — a one-click affordance in the steward section), semantic pass latency/cost.
- **Gate to active**: ≥30 shadow reviews; semantic type agreement with user's final accepted type ≥ heuristic's agreement; warning helpful-rate ≥ 60%.
- **Rollback**: disable-only — flip variant back to `heuristic`; persisted drafts keep whatever review they got; no schema change (all new fields optional JSON).
- **Purely additive, no promotion needed**: role registry file (default = today's constant), steward-notes injection (reads persisted state only; capped block; absent when no notes), `roleTags` (optional field), review-tab section.

## 7. Design Decisions

1. **Steward as config-defined RoleContract, not built-in.** Gains role-spawn's mechanical tool/permission enforcement without polluting the dev orchestration core or router role lists. Rejected: adding to `BUILT_IN_ROLE_CONTRACTS` (steward would appear in `roles.list` for orchestration UIs and could be routed into dev teams). Rejected: a separate KB-only role registry (duplicates `role-registry.ts` validation/resolution for one role).
2. **KB-local JSON registry for variants.** Consistent with `watched-directories.json`; keeps knowledge config next to knowledge data; survives app-store resets. Rejected: electron-store (wrong domain), runtime config (Steward executes in Main).
3. **Heuristic-first, semantic-second, always degradable.** The regex pass is free, instant, and offline; the LLM pass is judgment on top. Rejected: replacing regex with LLM (breaks offline review and adds cost to every draft).
4. **Steward voice = persisted-state injection, no turn-time LLM.** Chat latency budget is sacred; notes are computed at review time, injected at use time. Rejected: live steward consultation per send (latency, cost, and it would make the Steward an implicit conversation participant rather than an advisor).
5. **Role↔KB binding as `roleTags` relevance shaping.** See §3.4. Rejected: per-role vaults/ACLs (multi-tenant machinery in a single-tenant product); rejected: overloading `agentId` (Area 1 taxonomy).
6. **No new tab.** See §3.5.

## 8. Validation Approach

- **Registry fallback test**: missing/corrupt `steward-roles.json` → behavior byte-identical to `DEFAULT_STEWARD_CONFIG` (unit).
- **Boundary test**: a hand-edited registry entry with `canApplyDirectly: true` is rejected at load with a logged issue and the entry skipped.
- **Shadow-phase metrics** (§6): classification agreement, warning helpful-rate, latency/cost per semantic review.
- **Injection tests**: steward-notes block present iff persisted notes exist for attached refs; block respects the 2,000-char cap; non-KB sends unchanged (comms replay parity with feature unused).
- **E2E** (map §8 UI rule): Playwright spec for the review-tab steward section and the Configure variant list.
- **Success metric**: user-facing — drafts reach `applied` with fewer post-apply edits (steward caught issues pre-apply), and conversations citing flagged pages visibly acknowledge the flags.

## 9. Boundary Considerations

- **`canApplyDirectly: false`**: preserved as a literal type in `KnowledgeRolePlayerConfig` and re-validated at registry load for hand-edited files; the semantic pass's RoleContract carries `tools: ['read']` + `filesystem: 'read'` + `network: 'none'`, so even the spawned steward is mechanically incapable of writes — two independent enforcement layers.
- **Wiki write boundary**: `applyReviewedChange` remains the sole write path, user-confirmation-gated; nothing in this design adds a write route.
- **Chat injection boundary**: steward notes join the existing untrusted-metadata block pattern with an explicit "do not modify knowledge" instruction and their own char cap — the read-only discipline of `applyKnowledgeMetadata` extends unchanged.
- **New boundaries introduced**: (1) semantic-pass confidence threshold — low-confidence LLM reviews defer to the heuristic; (2) registry validation boundary — no variant may exceed the default steward's capability ceiling; (3) `roleTags` shapes ranking only, never access — every KB read remains available to every role.
