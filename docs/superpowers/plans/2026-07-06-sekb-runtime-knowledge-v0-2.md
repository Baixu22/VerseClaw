# SEKB Runtime Knowledge v0.2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the SEKB MVP from a standalone runtime module into an explicitly enabled, advisory runtime knowledge loop that can capture real agent runs, inject bounded advice, and support manual distillation without adding UI or autonomous correction.

**Architecture:** Keep SEKB under `openclaw_runtime/src/knowledge/sekb/` and wire it through existing `CoreAgentHarness` hooks instead of changing the low-level agent loop. The integration is no-op unless explicitly installed by a runtime caller. SEKB failures must not interrupt agent execution.

**Tech Stack:** TypeScript ESM, Vitest, existing AgentHarness hooks, shared OpenClaw state SQLite DB, generated Kysely table types, no vector database, no new renderer UI.

## Global Constraints

- Branch scope is `codex/sekb-runtime-knowledge`; keep unrelated `knowledge-ux`, `runtime-intensity`, and `context-runtime-kit` work out of commits.
- Use runtime-side SQLite/OpenClaw persistence patterns; do not add a required external database or vector service.
- Embeddings remain optional and nullable; lexical retrieval must remain deterministic when embeddings are absent.
- Renderer/Main boundary stays intact; no direct renderer IPC, Gateway HTTP, or Gateway WebSocket calls.
- SEKB integration is advisory/explicit only: no automatic pausing, retrying, hidden correction, output rewriting, or tool blocking.
- Do not add a new config/env surface for v0.2. The integration is enabled only by explicit installer call options.
- Do not add a renderer UI in this branch. Any future UI must use `src/lib/host-api.ts`, i18n locale coverage, and Electron E2E coverage.
- Runtime subtree policy applies: persistent runtime state belongs in SQLite, Kysely helpers are preferred over raw SQL outside schema/bootstrap code, and no JSON sidecar state is added.
- Docs sync rule applies: functional or architecture changes must explicitly declare whether README translation updates are required.

---

## File Structure

- Modify `openclaw_runtime/src/knowledge/sekb/retrieval-engine.ts`
  - Owns SEKB retrieval and advisory prompt formatting.
- Modify `openclaw_runtime/src/knowledge/sekb/sekb.test.ts`
  - Keeps MVP storage/retrieval/distillation coverage and adds v0.2 text/integration behavior.
- Create `openclaw_runtime/src/knowledge/sekb/harness-integration.ts`
  - Installs optional SEKB hooks onto an AgentHarness-like target.
- Modify `openclaw_runtime/src/knowledge/sekb/index.ts`
  - Exports the v0.2 integration entrypoint.
- Modify `docs/enhancements/sekb-mvp.md`
  - Documents v0.2 integration shape, no-op default, manual distillation path, and non-goals.
- Modify `harness/specs/tasks/sekb-mvp.md`
  - Adds the v0.2 acceptance criteria and validation profile notes.
- Keep `openclaw_runtime/src/state/openclaw-state-schema.sql` and generated schema files as the SEKB MVP persistence surface.

---

### Task 0: Branch Hygiene And SEKB MVP Baseline

**Files:**
- Inspect: `docs/enhancements/sekb-mvp.md`
- Inspect: `docs/superpowers/plans/2026-07-06-sekb-mvp.md`
- Inspect: `harness/specs/tasks/sekb-mvp.md`
- Inspect: `openclaw_runtime/src/knowledge/sekb/**`
- Inspect: `openclaw_runtime/src/state/openclaw-state-schema.sql`

**Interfaces:**
- Consumes: Current SEKB MVP files restored from `codex/runtime-intensity-v1-pr-hygiene`.
- Produces: A clean SEKB-only baseline commit candidate on `codex/sekb-runtime-knowledge`.

- [ ] **Step 1: Confirm branch and intended dirty set**

Run:

```powershell
git branch --show-current
git status --short --branch
git status --short --untracked-files=all -- docs/enhancements/sekb-mvp.md docs/superpowers/plans/2026-07-06-sekb-mvp.md harness/specs/tasks/sekb-mvp.md openclaw_runtime/src/knowledge/sekb openclaw_runtime/src/state/openclaw-state-schema.sql openclaw_runtime/src/state/openclaw-state-db.generated.d.ts openclaw_runtime/src/state/openclaw-state-schema.generated.ts
```

Expected:

```text
codex/sekb-runtime-knowledge
```

The SEKB dirty set is limited to SEKB docs, harness task spec, `openclaw_runtime/src/knowledge/sekb/**`, and state schema/generated files.

- [ ] **Step 2: Run current focused SEKB proof**

Run from `openclaw_runtime`:

```powershell
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
node scripts/generate-kysely-types.mjs --verify
```

Expected: focused SEKB tests pass and generated schema verification passes.

- [ ] **Step 3: Stage only SEKB baseline files**

Run:

```powershell
git add docs/enhancements/sekb-mvp.md docs/superpowers/plans/2026-07-06-sekb-mvp.md harness/specs/tasks/sekb-mvp.md openclaw_runtime/src/knowledge/sekb openclaw_runtime/src/state/openclaw-state-schema.sql openclaw_runtime/src/state/openclaw-state-db.generated.d.ts openclaw_runtime/src/state/openclaw-state-schema.generated.ts
git diff --cached --name-only
```

Expected: no `context-runtime-kit`, `knowledge-ux`, or unrelated runtime files are staged.

- [ ] **Step 4: Commit MVP baseline**

Run:

```powershell
git commit -m "feat: add sekb runtime knowledge MVP"
```

Expected: one SEKB-only baseline commit exists on `codex/sekb-runtime-knowledge`.

---

### Task 1: Normalize Advisory Prompt Text

**Files:**
- Modify: `openclaw_runtime/src/knowledge/sekb/retrieval-engine.ts`
- Modify: `openclaw_runtime/src/knowledge/sekb/sekb.test.ts`

**Interfaces:**
- Consumes: `RetrievalEngine.format_for_injection(principles: Principle[]): string`
- Produces: ASCII-safe advisory text with stable labels for task and error injection.

- [ ] **Step 1: Write the failing text regression test**

Add or update assertions in `openclaw_runtime/src/knowledge/sekb/sekb.test.ts`:

```ts
const formatted = engine.format_for_injection(errorMatches);
expect(formatted).toContain("[Relevant SEKB principle 1] Check PG access");
expect(formatted).toContain("Condition: When PostgreSQL reports Connection refused");
expect(formatted).toContain("Action: Check pg_hba.conf and firewall rules");
expect(formatted).toContain("Reason: Most connection refusals are environment");
expect(formatted).not.toMatch(/[銆慭锛]/u);

const injector = engine.create_context_injector();
expect(injector.for_error("ConnectionError::db_connection_refused::postgresql", ["postgresql"]))
  .toContain("[SEKB historical error advice]");
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run from `openclaw_runtime`:

```powershell
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
```

Expected: FAIL because existing text contains mojibake labels.

- [ ] **Step 3: Replace prompt labels with ASCII text**

In `openclaw_runtime/src/knowledge/sekb/retrieval-engine.ts`, make the formatter shape:

```ts
format_for_injection(principles: Principle[]): string {
  return principles
    .map((principle, index) =>
      [
        `[Relevant SEKB principle ${index + 1}] ${principle.title}`,
        `Condition: ${principle.condition}`,
        `Action: ${principle.action}`,
        `Reason: ${principle.reason}`,
        "---",
      ].join("\n")
    )
    .join("\n");
}
```

And make error advice prefix:

```ts
return injection ? `[SEKB historical error advice]\n${injection}` : "";
```

- [ ] **Step 4: Run focused proof**

Run from `openclaw_runtime`:

```powershell
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add openclaw_runtime/src/knowledge/sekb/retrieval-engine.ts openclaw_runtime/src/knowledge/sekb/sekb.test.ts
git commit -m "fix: normalize sekb advisory prompt text"
```

---

### Task 2: Add Explicit AgentHarness SEKB Hook Installer

**Files:**
- Create: `openclaw_runtime/src/knowledge/sekb/harness-integration.ts`
- Modify: `openclaw_runtime/src/knowledge/sekb/index.ts`
- Modify: `openclaw_runtime/src/knowledge/sekb/sekb.test.ts`

**Interfaces:**
- Consumes:
  - `TrajectoryCapture`
  - `ContextInjector`
  - `RetrievalEngine`
  - AgentHarness-like hook methods `on(type, handler)` and `subscribe(listener)`
- Produces:
  - `installSekbHarnessHooks(target: SekbHarnessHookTarget, options: InstallSekbHarnessHooksOptions): () => void`
  - `SekbTaskClassifier`
  - `SekbHarnessHookTarget`

- [ ] **Step 1: Write failing installer tests**

Add tests in `openclaw_runtime/src/knowledge/sekb/sekb.test.ts` that use a fake hook target:

```ts
it("installs explicit SEKB harness hooks without blocking tool execution", async () => {
  const store = createStore();
  const capture = new TrajectoryCapture({ store, now: fixedClock() });
  const engine = new RetrievalEngine({ store });
  const target = createHookTarget();

  store.save_principle(postgresPrinciple());

  const uninstall = installSekbHarnessHooks(target, {
    enabled: true,
    capture,
    injector: engine.create_context_injector(),
    classifyTask: ({ prompt }) => ({
      task_intent: prompt,
      task_type: "config/db",
      context_tags: ["postgresql"],
    }),
  });

  const before = await target.emitHook("before_agent_start", {
    type: "before_agent_start",
    prompt: "configure database connection",
    systemPrompt: "system",
    resources: {},
  });
  expect(before?.systemPrompt).toContain("[Relevant SEKB principle 1]");

  await target.emitHook("tool_call", {
    type: "tool_call",
    toolCallId: "call-1",
    toolName: "shell",
    input: { command: "psql" },
  });
  const patch = await target.emitHook("tool_result", {
    type: "tool_result",
    toolCallId: "call-1",
    toolName: "shell",
    input: { command: "psql" },
    content: [{ type: "text", text: "could not connect to server: Connection refused (port 5432)" }],
    details: {},
    isError: true,
  });
  expect(patch?.content?.[0]).toMatchObject({
    type: "text",
    text: expect.stringContaining("[SEKB historical error advice]"),
  });

  await target.emitEvent({ type: "agent_end", messages: [] });
  expect(store.query_trajectories({ task_type: "config/db", context_tags: ["postgresql"] }))
    .toHaveLength(1);
  uninstall();
});
```

The fake target only needs to support hook registration and event replay:

```ts
function createHookTarget() {
  const hooks = new Map<string, Array<(event: unknown) => unknown>>();
  const subscribers: Array<(event: unknown) => unknown> = [];
  return {
    on(type: string, handler: (event: unknown) => unknown) {
      hooks.set(type, [...(hooks.get(type) ?? []), handler]);
      return () => hooks.set(type, (hooks.get(type) ?? []).filter((entry) => entry !== handler));
    },
    subscribe(listener: (event: unknown) => unknown) {
      subscribers.push(listener);
      return () => {
        const index = subscribers.indexOf(listener);
        if (index >= 0) subscribers.splice(index, 1);
      };
    },
    async emitHook(type: string, event: unknown) {
      let latest;
      for (const handler of hooks.get(type) ?? []) latest = await handler(event);
      return latest as { systemPrompt?: string; content?: Array<{ type: "text"; text: string }> } | undefined;
    },
    async emitEvent(event: unknown) {
      for (const listener of subscribers) await listener(event);
    },
  };
}
```

- [ ] **Step 2: Run test and confirm failure**

Run from `openclaw_runtime`:

```powershell
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
```

Expected: FAIL because `installSekbHarnessHooks` is not exported.

- [ ] **Step 3: Implement the hook installer**

Create `openclaw_runtime/src/knowledge/sekb/harness-integration.ts` with these exported contracts:

```ts
import type { ContextInjector } from "./retrieval-engine.js";
import type { TrajectoryCapture } from "./trajectory-capture.js";

export type SekbTaskClassification = {
  task_intent: string;
  task_type: string;
  context_tags: string[];
};

export type SekbTaskClassifier = (event: {
  prompt: string;
  systemPrompt: string;
  resources: unknown;
}) => SekbTaskClassification;

export type SekbHarnessHookTarget = {
  on(type: string, handler: (event: unknown) => unknown | Promise<unknown>): () => void;
  subscribe(listener: (event: unknown) => unknown | Promise<unknown>): () => void;
};

export type InstallSekbHarnessHooksOptions = {
  enabled: boolean;
  capture: TrajectoryCapture;
  injector: ContextInjector;
  classifyTask?: SekbTaskClassifier;
  onError?: (error: unknown) => void;
};
```

Core behavior:

```ts
export function installSekbHarnessHooks(
  target: SekbHarnessHookTarget,
  options: InstallSekbHarnessHooksOptions,
): () => void {
  if (!options.enabled) {
    return () => {};
  }

  let active: { trajectoryId: string; tags: string[]; rawError: string | null } | null = null;
  const classify = options.classifyTask ?? defaultSekbTaskClassifier;

  const unsubs = [
    target.on("before_agent_start", (event) =>
      safe(options, () => {
        const payload = readBeforeAgentStartEvent(event);
        if (!payload) return undefined;
        const classification = classify(payload);
        active = {
          trajectoryId: options.capture.start_trajectory(
            classification.task_intent,
            classification.task_type,
            classification.context_tags,
          ),
          tags: classification.context_tags,
          rawError: null,
        };
        return {
          systemPrompt: options.injector.for_task(
            payload.systemPrompt,
            classification.task_intent,
            classification.task_type,
            classification.context_tags,
          ),
        };
      })
    ),
    target.on("tool_call", (event) =>
      safe(options, () => {
        const payload = readToolCallEvent(event);
        if (active && payload) {
          options.capture.log_step(active.trajectoryId, "tool.call", payload.input, {
            toolName: payload.toolName,
            toolCallId: payload.toolCallId,
          });
        }
        return undefined;
      })
    ),
    target.on("tool_result", (event) =>
      safe(options, () => {
        const payload = readToolResultEvent(event);
        if (!active || !payload) return undefined;
        options.capture.log_step(active.trajectoryId, "tool.result", payload.input, {
          toolName: payload.toolName,
          toolCallId: payload.toolCallId,
          isError: payload.isError,
          content: payload.content,
        });
        if (!payload.isError) return undefined;
        active.rawError = textFromContent(payload.content);
        const signature = options.capture.extract_error_signature(active.rawError);
        const advice = options.injector.for_error(signature, active.tags);
        return advice ? { content: appendAdvice(payload.content, advice) } : undefined;
      })
    ),
    target.subscribe((event) =>
      safe(options, () => {
        const type = readEventType(event);
        if (!active) return undefined;
        if (type === "agent_end") {
          options.capture.finish_trajectory(
            active.trajectoryId,
            active.rawError ? "failure" : "success",
            active.rawError,
          );
          active = null;
        }
        if (type === "abort") {
          options.capture.finish_trajectory(active.trajectoryId, "partial", active.rawError);
          active = null;
        }
        return undefined;
      })
    ),
  ];

  return () => {
    for (const unsub of unsubs.splice(0)) unsub();
  };
}
```

Implement local readers with `unknown` input and narrow checks; do not use `any`.

Use these local helper shapes in the same file so hook handlers stay defensive
without widening public exports:

```ts
type TextBlock = { type: "text"; text: string };
type ContentBlock = TextBlock | { type: string; [key: string]: unknown };

type BeforeAgentStartPayload = {
  prompt: string;
  systemPrompt: string;
  resources: unknown;
};

type ToolCallPayload = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

type ToolResultPayload = ToolCallPayload & {
  content: ContentBlock[];
  details: unknown;
  isError: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readEventType(value: unknown): string | null {
  return isRecord(value) && typeof value.type === "string" ? value.type : null;
}

function readBeforeAgentStartEvent(value: unknown): BeforeAgentStartPayload | null {
  if (!isRecord(value)) return null;
  if (value.type !== "before_agent_start") return null;
  if (typeof value.prompt !== "string" || typeof value.systemPrompt !== "string") return null;
  return {
    prompt: value.prompt,
    systemPrompt: value.systemPrompt,
    resources: value.resources,
  };
}

function readInput(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readToolCallEvent(value: unknown): ToolCallPayload | null {
  if (!isRecord(value) || value.type !== "tool_call") return null;
  if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string") return null;
  return {
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    input: readInput(value.input),
  };
}

function readContent(value: unknown): ContentBlock[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is ContentBlock => isRecord(entry) && typeof entry.type === "string")
    : [];
}

function readToolResultEvent(value: unknown): ToolResultPayload | null {
  if (!isRecord(value) || value.type !== "tool_result") return null;
  if (typeof value.toolCallId !== "string" || typeof value.toolName !== "string") return null;
  return {
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    input: readInput(value.input),
    content: readContent(value.content),
    details: value.details,
    isError: value.isError === true,
  };
}

function isTextBlock(value: ContentBlock): value is TextBlock {
  return value.type === "text" && typeof value.text === "string";
}

function textFromContent(content: ContentBlock[]): string {
  return content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function appendAdvice(content: ContentBlock[], advice: string): ContentBlock[] {
  const firstTextIndex = content.findIndex(isTextBlock);
  if (firstTextIndex < 0) {
    return [{ type: "text", text: advice }, ...content];
  }
  return content.map((entry, index) =>
    index === firstTextIndex && isTextBlock(entry)
      ? { ...entry, text: `${entry.text}\n\n${advice}` }
      : entry
  );
}

function defaultSekbTaskClassifier(event: BeforeAgentStartPayload): SekbTaskClassification {
  return {
    task_intent: event.prompt,
    task_type: "agent/task",
    context_tags: [],
  };
}

function safe<T>(
  options: Pick<InstallSekbHarnessHooksOptions, "onError">,
  operation: () => T,
): T | undefined {
  try {
    return operation();
  } catch (error) {
    options.onError?.(error);
    return undefined;
  }
}
```

- [ ] **Step 4: Export the installer**

Modify `openclaw_runtime/src/knowledge/sekb/index.ts`:

```ts
export {
  installSekbHarnessHooks,
  type InstallSekbHarnessHooksOptions,
  type SekbHarnessHookTarget,
  type SekbTaskClassification,
  type SekbTaskClassifier,
} from "./harness-integration.js";
```

- [ ] **Step 5: Run focused proof**

Run from `openclaw_runtime`:

```powershell
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
```

Expected: PASS. The test proves SEKB is explicitly installed, appends advisory text on tool errors, and records one trajectory.

- [ ] **Step 6: Commit**

Run:

```powershell
git add openclaw_runtime/src/knowledge/sekb/harness-integration.ts openclaw_runtime/src/knowledge/sekb/index.ts openclaw_runtime/src/knowledge/sekb/sekb.test.ts
git commit -m "feat: add explicit sekb harness integration"
```

---

### Task 3: Add Manual Distillation Operator Report

**Files:**
- Create: `openclaw_runtime/src/knowledge/sekb/operator-report.ts`
- Modify: `openclaw_runtime/src/knowledge/sekb/index.ts`
- Modify: `openclaw_runtime/src/knowledge/sekb/sekb.test.ts`

**Interfaces:**
- Consumes: `KnowledgeStore.query_trajectories`, `KnowledgeStore.query_principles`, `KnowledgeStore.get_index`, `DistillationTool.suggest_principles_from_trajectories`
- Produces:
  - `buildSekbOperatorReport(store: KnowledgeStore, options?: SekbOperatorReportOptions): SekbOperatorReport`
  - A read-only report object suitable for a future CLI or Developer Workbench.

- [ ] **Step 1: Write failing report test**

Add to `openclaw_runtime/src/knowledge/sekb/sekb.test.ts`:

```ts
it("builds a read-only SEKB operator report for manual distillation", () => {
  const store = createStore();
  const trajectoryId = randomUUID();
  store.save_trajectory({
    trajectory_id: trajectoryId,
    created_at: "2026-07-06T08:00:00.000Z",
    task_intent: "connect PostgreSQL",
    task_type: "config/db",
    context_fingerprint: ["postgresql"],
    steps: [],
    outcome: "failure",
    error_signature: "ConnectionError::db_connection_refused::postgresql",
    cost: { tokens: 0, duration_seconds: 1, retries: 0 },
    distilled: false,
    distilled_into: [],
    expires_at: null,
    metadata: {},
  });
  store.save_principle(postgresPrinciple({ source_trajectories: [trajectoryId] }));

  const report = buildSekbOperatorReport(store);
  expect(report.counts).toMatchObject({
    trajectories: 1,
    undistilledTrajectories: 1,
    activePrinciples: 1,
  });
  expect(report.undistilled[0]).toMatchObject({
    trajectory_id: trajectoryId,
    task_type: "config/db",
    outcome: "failure",
  });
  expect(report.indexPreview).toContain("Check PG access");
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run from `openclaw_runtime`:

```powershell
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
```

Expected: FAIL because `buildSekbOperatorReport` does not exist.

- [ ] **Step 3: Implement read-only report builder**

Create `openclaw_runtime/src/knowledge/sekb/operator-report.ts`:

```ts
import type { KnowledgeStore } from "./knowledge-store.js";
import type { PrincipleCriticality, TrajectoryOutcome } from "./types.js";

export type SekbOperatorReportOptions = {
  undistilledLimit?: number;
};

export type SekbOperatorReport = {
  counts: {
    trajectories: number;
    undistilledTrajectories: number;
    activePrinciples: number;
  };
  undistilled: Array<{
    trajectory_id: string;
    created_at: string;
    task_intent: string;
    task_type: string;
    context_fingerprint: string[];
    outcome: TrajectoryOutcome;
    error_signature: string | null;
  }>;
  activePrinciples: Array<{
    principle_id: string;
    title: string;
    task_types: string[];
    context_tags: string[];
    criticality: PrincipleCriticality;
    retrieval_count: number;
    adoption_count: number;
  }>;
  indexPreview: string;
};

export function buildSekbOperatorReport(
  store: KnowledgeStore,
  options: SekbOperatorReportOptions = {},
): SekbOperatorReport {
  const trajectories = store.query_trajectories({});
  const undistilled = trajectories.filter((trajectory) => !trajectory.distilled);
  const activePrinciples = store.query_principles({ status: "active" });
  return {
    counts: {
      trajectories: trajectories.length,
      undistilledTrajectories: undistilled.length,
      activePrinciples: activePrinciples.length,
    },
    undistilled: undistilled.slice(0, options.undistilledLimit ?? 20).map((trajectory) => ({
      trajectory_id: trajectory.trajectory_id,
      created_at: trajectory.created_at,
      task_intent: trajectory.task_intent,
      task_type: trajectory.task_type,
      context_fingerprint: trajectory.context_fingerprint,
      outcome: trajectory.outcome,
      error_signature: trajectory.error_signature,
    })),
    activePrinciples: activePrinciples.map((principle) => ({
      principle_id: principle.principle_id,
      title: principle.title,
      task_types: principle.task_types,
      context_tags: principle.context_tags,
      criticality: principle.criticality,
      retrieval_count: principle.retrieval_count,
      adoption_count: principle.adoption_count,
    })),
    indexPreview: store.get_index(),
  };
}
```

- [ ] **Step 4: Export report builder**

Modify `openclaw_runtime/src/knowledge/sekb/index.ts`:

```ts
export {
  buildSekbOperatorReport,
  type SekbOperatorReport,
  type SekbOperatorReportOptions,
} from "./operator-report.js";
```

- [ ] **Step 5: Run focused proof**

Run from `openclaw_runtime`:

```powershell
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add openclaw_runtime/src/knowledge/sekb/operator-report.ts openclaw_runtime/src/knowledge/sekb/index.ts openclaw_runtime/src/knowledge/sekb/sekb.test.ts
git commit -m "feat: add sekb operator report"
```

---

### Task 4: Update SEKB Development Docs And Harness Spec

**Files:**
- Modify: `docs/enhancements/sekb-mvp.md`
- Modify: `harness/specs/tasks/sekb-mvp.md`
- Modify: `docs/superpowers/plans/2026-07-06-sekb-runtime-knowledge-v0-2.md`

**Interfaces:**
- Consumes: Tasks 1-3 behavior and harness context output.
- Produces: Documentation that says what v0.2 does, how to enable it, and what remains out of scope.

- [ ] **Step 1: Update SEKB enhancement doc**

Add a `Runtime Hook Integration v0.2` section to `docs/enhancements/sekb-mvp.md`:

```md
## Runtime Hook Integration v0.2

SEKB can be attached to an AgentHarness-like runtime with
`installSekbHarnessHooks(target, options)`. The installer is explicit and
default-off: callers must pass `enabled: true` plus a `TrajectoryCapture` and
`ContextInjector`.

The hook installer uses existing harness seams:

- `before_agent_start` starts an L3 trajectory and appends bounded task advice
  to the system prompt.
- `tool_call` and `tool_result` record tool steps.
- failed `tool_result` events append visible SEKB historical error advice to
  the tool result content for the next model turn.
- `agent_end` finishes the trajectory as success or failure.
- `abort` finishes the trajectory as partial.

SEKB hook failures are swallowed and reported through the optional `onError`
callback so knowledge capture cannot break the agent run.

No v0.2 path pauses tools, retries work, blocks tool calls, silently rewrites
tool output, or writes L2 principles without `DistillationTool.confirm_and_save()`.
```

- [ ] **Step 2: Update harness task spec acceptance**

Add v0.2 acceptance bullets to `harness/specs/tasks/sekb-mvp.md`:

```md
  - AgentHarness integration, if enabled, uses existing hook seams and remains no-op unless explicitly installed.
  - SEKB hook failures do not fail agent execution; they are reported only through an optional diagnostic callback.
  - Tool-error advice is visible advisory context, not a hidden correction, retry, pause, or block.
  - The operator report is read-only and does not write principles or mark trajectories distilled.
```

- [ ] **Step 3: Declare README translation status**

Add to `docs/enhancements/sekb-mvp.md`:

```md
README translation updates are not required for v0.2 because the branch adds
runtime-side explicit hook integration and a read-only operator report, with no
new renderer page, visible navigation, or end-user desktop workflow.
```

- [ ] **Step 4: Commit docs**

Run:

```powershell
git add docs/enhancements/sekb-mvp.md harness/specs/tasks/sekb-mvp.md docs/superpowers/plans/2026-07-06-sekb-runtime-knowledge-v0-2.md
git commit -m "docs: define sekb runtime knowledge v0.2"
```

---

### Task 5: Validation Gate And PR-Ready Evidence

**Files:**
- Verify: `openclaw_runtime/src/knowledge/sekb/**`
- Verify: `openclaw_runtime/src/state/openclaw-state-schema.sql`
- Verify: `harness/specs/tasks/sekb-mvp.md`

**Interfaces:**
- Consumes: Tasks 0-4.
- Produces: branch proof suitable for PR handoff.

- [ ] **Step 1: Run generated schema proof**

Run from `openclaw_runtime`:

```powershell
node scripts/generate-kysely-types.mjs --verify
```

Expected: generated Kysely files match the schema.

- [ ] **Step 2: Run focused SEKB tests**

Run from `openclaw_runtime`:

```powershell
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
```

Expected: all SEKB tests pass.

- [ ] **Step 3: Run harness validation**

Run from repo root:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' harness validate --spec harness/specs/tasks/sekb-mvp.md --no-diff
```

Expected: spec structure and selected validation metadata pass.

- [ ] **Step 4: Run comms evidence only if communication paths changed**

If this branch touches Gateway events, runtime send/receive, channel delivery, or fallback behavior, run:

```powershell
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run comms:replay
& 'C:\Users\27933\AppData\Roaming\npm\pnpm.cmd' run comms:compare
```

Expected: no regression report for touched communication behavior.

If the branch only adds explicit AgentHarness hooks under `openclaw_runtime/src/knowledge/sekb/**`, record that comms replay was not required because Gateway transport, channel delivery, and renderer/Main host API behavior were not changed.

- [ ] **Step 5: Final branch status check**

Run:

```powershell
git status --short --branch
git log --oneline --decorate -5
git diff --stat origin/main...HEAD
```

Expected: branch contains only SEKB runtime knowledge commits and no unrelated untracked files are staged.
