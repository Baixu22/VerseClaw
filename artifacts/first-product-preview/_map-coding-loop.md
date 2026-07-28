Investigation complete. Findings below.

---

# FP-P1-04 coding loop map — path:line facts

**Headline correction to the task doc:** FP-P1-04 is *not* untouched. `write-journal.ts` and `tests/e2e/coding-loop-fp-p1-04.spec.ts` already carry FP-P1-04 annotations (hard-lock undo, lineage, disk rehydration, 4-turn E2E). The doc's `status: backlog` is stale. The real remaining hole is **verify**.

Also a naming trap: **`context_read` / `context_search` / `context_write` are NOT the file-I/O tools of this loop.** They read/write DCS *context Blocks*; `context_write` writes only `notes` Blocks (`context-write-tool.ts:82-100`), never files. The file loop is `read` / `edit` / `write` / `apply_patch` / `undo_write`.

## 1. Context read/search/write tools — registration

| item | path:line |
|---|---|
| Library impls | `openclaw_runtime/src/context-engine/tools/context-read-tool.ts:92` `readContext`; `context-search-tool.ts:50` `searchContext`; `context-write-tool.ts:46` `writeContext` |
| Tool-name constants | `openclaw_runtime/src/agents/tools/context-agent-tools.ts:60-66` |
| Factories | same file: `createContextReadTool:271`, `createContextSearchTool:303`, `createContextWriteTool:338`, `createContextImpactTool:407`, `createContextUnderstandTool:463`, `createContextReuseTool:511`, `createContextVerifyTool:582` |
| Bundle factory | `context-agent-tools.ts:684` `createDcsContextAgentTools` |
| **REGISTRATION SITE** | `openclaw_runtime/src/agents/agent-tools.ts:942-955` — called, result pushed into `base` |
| BlockStore | `openclaw_runtime/src/context-engine/block-store.ts:46` class `BlockStore`; `query:149`, `queryByEntity:153`, `upsert:62`, `invalidate:161`, `stats:173` |

Dep-gated: read/search return `null` without `sessionId` + `blockStore` (`:272-275`, `:304-307`); write needs `sessionId` + `contextBlockSink` (`:339-343`). The 4 view tools additionally need `factService` and pass `isDcsContextViewToolsEnabled()` (`:247-261`).

## 2. Write journal + undo

`openclaw_runtime/src/agents/tools/write-journal.ts` (409 lines) — this segment is the most complete.

| export | line |
|---|---|
| `journalDirFor` | `:52` → `<workspaceRoot>/.openclaw/journal/<sessionId>` |
| `getOrCreateWriteJournal` | `:99` |
| `snapshotBeforeWrite` | `:122` |
| `undoLastWrites` | `:198` |
| `clearWriteJournal` | `:254` |
| `extractPatchTargetPaths` | `:272` |
| `wrapToolWithWriteJournal` | `:294` |
| `createUndoWriteTool` | `:354` (tool name `undo_write`, `:24`) |
| `rehydrateJournalFromDisk` (private) | `:61` |

**Recorded per write** (`WriteJournalEntry`, `:26-41`): `seq`, `relPath`, `absPath`, `snapshotPath`, `hadPrior`, `toolName`, `createdAtMs`, and `lineage: { sessionId, workspaceRoot, gatewayGeneration? }`. Persisted twice — binary pre-image `NNNN-<base>.pre` plus `.pre.meta.json` sidecar (`:168-180`). Disk is source of truth; `:61` rebuilds in-memory state on restart, so undo survives a gateway bounce.

**Undo API:** `undoLastWrites` (`:198`). Hard-lock semantics are implemented, not aspirational — `:237-244` `break`s on first failure, and `:228` only pops the entry after a fully successful restore, so a failed entry and everything older stay in the journal. Missing snapshot with `hadPrior` throws rather than silently skipping (`:217-220`). Create-writes are undone by `unlink` (`:222-226`).

**Wiring:** `agent-tools.ts:787` inside `applyWriteKit` (journal wraps *first*, so snapshot precedes all other write layers), `:956` registers `undo_write` gated on `writeJournalEnabled && includeBaseCodingTools`.

**Lineage gap vs. AC:** AC line 47 wants `request / session / workspace / flags`. Present: session, workspace, gatewayGeneration. **Missing: requestId and the flags snapshot.**

Default ON: `runtime-feature-leaves.ts:57` `writeJournal: { enabled: true }`, `coding-runtime-flags.ts:17`.

## 3. Workspace boundary enforcement

- `electron/services/workspace-preflight.ts` — `isSensitiveWorkspacePath:62`, `summarizePreflight:87`, `runWorkspacePreflight:100`. Checks exists/readable/writable/git/sensitivePath/diskSpace. Note `:92-97`: a `writable` fail is non-blocking → read-only fallback; any other fail blocks. Writable is probed with a real `mkdtemp` (`:135`), not `access(W_OK)` — deliberate for Windows ACLs.
- Runtime enforcement is a *different* layer: `openclaw_runtime/src/agents/agent-tools.read.ts:445` `wrapToolWorkspaceRootGuard` → `:746` `wrapToolWorkspaceRootGuardWithOptions`, which resolves each path param through `assertSandboxPathWithinAnyRoot` (`:810`) against realpaths.
- Applied at `agent-tools.ts:866-915` per tool. `applyPatchWorkspaceOnly` (`:842`) is secure-by-default: workspace-contained unless explicitly disabled.
- `agents.defaults.workspace` is pinned to the active workspace by `electron/services/workspaces-api.ts:495` and `electron/services/workspace-runtime-sync.ts:47-48`; read at `electron/utils/agent-config.ts:253`.
- Sandbox variant: `sandboxRoot = sandbox?.workspaceDir` (`agent-tools.ts:748`), `allowWorkspaceWrites = sandbox?.workspaceAccess !== "ro"` (`:750`) — filters write tools out entirely at `:911`.

## 4. Diff

Renderer components exist but are **not connected to the coding write path**:
- `src/components/tool-ui/code-diff/code-diff.tsx:446` `CodeDiff`, consumed at `src/components/tool-ui/agent-interactions.tsx:3158`, parsed by `parseCodeDiff:1300`, type discriminated at `:478`.
- `src/components/file-preview/MonacoDiffViewer.tsx:35` — used only by `FilePreviewBody.tsx:642` and `WorkspaceGitPanel.tsx:968` (git panel / file preview, not chat tool output).

Diff *generation* is real and lives runtime-side: `openclaw_runtime/src/agents/sessions/tools/edit-diff.ts:332` `generateUnifiedPatch`, `:348` `generateDiffString`, `:491` `computeEditsDiff`, `:542` `computeEditDiff`. Consumed at `edit.ts:436-448`, which puts `{ diff, patch, firstChangedLine }` into `result.details`.

**Two concrete gaps:**
1. `grep code-diff` across `openclaw_runtime/src`, `electron/`, `shared/` returns **zero hits** — nothing emits the `code-diff` interaction payload the renderer parses. The `edit` tool's `details.diff` reaches the TUI renderer (`edit.ts:14` `renderDiff`, `:334`) but not the Electron chat UI.
2. The full-file `write` tool (`sessions/tools/write.ts`) produces **no diff at all** — only a `"different" | "same" | "unknown"` precheck state (`:90`, `:301`). A `write`-based edit gives the user nothing to review.

## 5. Verify / test runner — **THE MISSING SEGMENT**

Syntax check exists:
- `openclaw_runtime/src/agents/post-write-parse-check.ts:23` `checkFileSyntax`, `:94` `checkFileSyntaxWithTimeout`, `:125` `formatSyntaxCheckFailed`, `:130` `attachSyntaxCheckToResult`, `:147` `recordSyntaxCheckMetric`. TS/JS via `ts.transpileModule` (`:73`); other languages via `analyzeFileWithRegistry`; `unknown` language returns `{ ok: true }` (`:42-45`) — deliberately never false-positive, but it means "skipped" is indistinguishable from "passed" at the call site.
- Wired at `openclaw_runtime/src/agents/write-side-effects.ts:117-151` inside `wrapToolWithWriteSideEffects:88`, enabled at `agent-tools.ts:807`.
- Type-level diag: `post-write-diag.ts` via `:154-181`.

**Test runner: no implementation exists.** `grep -rniE "testRunner|detectTestRunner|runTests|vitest|jest|pytest|cargo test"` over `openclaw_runtime/src` + `electron` + `src` (excluding `.test.ts`) returns nothing that probes or executes a project test suite. `scripts.test` from package.json is never read anywhere.

The closest thing is `reviewDiff` (`openclaw_runtime/src/context-engine/views/verify/review-diff-view.ts:45`), whose `relatedTests: string[]` (`:12`, `:78`) only *names* test files from FactStore `tested_by` edges. `write-side-effects.ts:184-215` attaches those names to `details.verify_consume`. **It never runs them.** Nothing satisfies the doc's "无 test runner 时明说跳过原因" — there is no detection, therefore no skip-reason path.

## 6. Observability

`openclaw_runtime/src/context-engine/coding-observability.ts` — singleton at `:237`, snapshot type `:5-48`, `CODING_METRIC_NAMES` `:239-261`.

| segment | counters | recorder |
|---|---|---|
| read | `factToolCalls`, `factToolCallsByName`, `factStoreHits`, `factStoreMisses`, `touchCount`, `touchLatencyMs{Sum,Max}`, `dupToolCalls`, `tokenCost` | `recordFactToolCall:102`, `recordFactStoreHit:108`, `recordTouchLatency:118` |
| write | `parseOnWriteHits`, `staleBlocks`, `staleAllowances`, `journalLatencyMs{Sum,Max}`, `journalSnapshots`, `journalFailures` | `recordJournalLatency:129` |
| undo | `undoCount` | `recordUndo:137` (called `write-journal.ts:236`) |
| verify | `syntaxCheckHits`, `syntaxCheckSilent`, `verifyConsumeHits`, `diagHits`, `diagSilent` | `recordSyntaxCheck:138`, `recordVerifyConsumeHit:142` |
| diff | — | **none** |

`dcs-observability.ts` (`:19-51` snapshot, singleton `:272`) covers injection/budget only — `injectionBudgetTruncations`, `injectionBudgetDrops`, `turnInjectionDroppedChars`, `turnInjectionTruncatedChars`. These are context-injection truncation, **not** coding tool-output truncation.

**Observability gaps:**
- `createContextReadTool` / `createContextSearchTool` (`context-agent-tools.ts:271`, `:303`) call **neither** `recordFactToolCall` nor `recordFactStoreHit` — only the 4 view tools are instrumented (`:436`, `:494`, `:566`, `:614`). The read segment's "命中数可观测" requirement is unmet for the Block tools.
- No per-write truncation counter, no error/outcome counter, no diff counter.

## Verdict per segment

| segment | state |
|---|---|
| **read** | implemented; **hit/miss observability missing on `context_read`/`context_search`** |
| **write** | implemented + journal-wrapped, default ON; lineage missing `requestId` + flags |
| **diff** | generation implemented for `edit`; **not rendered in Electron chat (no `code-diff` producer); `write` tool emits no diff at all** |
| **verify** | syntax + type diag implemented; **test runner detection/execution — NO IMPLEMENTATION ANYWHERE** |
| **undo** | implemented, hard-lock semantics + disk rehydration, E2E T2/T4 cover it |

**The one segment with genuinely zero implementation is `verify`'s test-runner half.** `diff` is the second priority — it exists but is severed between runtime and renderer, so the user-visible "展示实际落盘前后差异" acceptance currently cannot pass in the Electron product.

Key files: `C:/Users/27933/Desktop/clawx/ClawX-maturity-p0/openclaw_runtime/src/agents/tools/write-journal.ts`, `.../openclaw_runtime/src/agents/tools/context-agent-tools.ts`, `.../openclaw_runtime/src/agents/agent-tools.ts`, `.../openclaw_runtime/src/agents/write-side-effects.ts`, `.../openclaw_runtime/src/agents/post-write-parse-check.ts`, `.../openclaw_runtime/src/agents/sessions/tools/edit-diff.ts`, `.../electron/services/workspace-preflight.ts`, `.../tests/e2e/coding-loop-fp-p1-04.spec.ts`