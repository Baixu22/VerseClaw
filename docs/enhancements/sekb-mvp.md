# SEKB-MVP

SEKB-MVP adds a runtime-side self-evolving knowledge substrate for OpenClaw. It is intentionally advisory in this slice: it records structured experience, stores confirmed principles, and formats retrieved principles for prompt injection, but it does not pause tools, retry work, silently correct output, or grant new authority.

## Runtime Integration

The core implementation lives in `openclaw_runtime/src/knowledge/sekb/`:

- `TrajectoryCapture` records L3 trajectories with `start_trajectory`, `log_step`, and `finish_trajectory`.
- `KnowledgeStore` persists L3 trajectories, L2 principles, the derived L1 index, error-signature cache entries, and distillation rejection records in the shared OpenClaw state SQLite DB.
- `RetrievalEngine` performs deterministic lexical retrieval when embeddings are absent and formats advisory context.
- `DistillationTool` supports manual confirmation through `confirm_and_save`; suggestions are never written automatically.

Minimal custom-runtime wiring is expected to be a thin wrapper around the task loop:

```ts
const trajectoryId = capture.start_trajectory(taskIntent, taskType, contextTags);
capture.log_step(trajectoryId, "tool.call", toolInput, toolOutput);
capture.finish_trajectory(trajectoryId, "success");
```

For failures, pass the raw error to `finish_trajectory`. The capture layer extracts and caches a deterministic signature such as `ConnectionError::db_connection_refused::postgresql`.

## Runtime Hook Integration v0.2

SEKB can be attached to an AgentHarness-like runtime with
`installSekbHarnessHooks(target, options)`. The installer is explicit and
default-off: callers must pass `enabled: true` plus a `TrajectoryCapture` and
`ContextInjector`.

The stable OpenClaw runtime owner seam is the plugin hook registration/runner
surface, not the `AgentHarness` capability object itself. Runtime owners enable
SEKB by calling `installSekbHarnessHooks(api, ...)` or an equivalent target that
implements the plugin-style `on(hookName, handler)` contract. The real hook
events used by the v0.2 adapter are:

- `before_agent_start` starts an L3 trajectory and returns bounded SEKB task
  advice as visible `appendContext` for real OpenClaw hook events. Legacy custom
  targets that provide an explicit `systemPrompt` still receive a `systemPrompt`
  result for compatibility.
- `before_tool_call` records the pending tool call and always returns no
  blocking or parameter rewrite.
- `tool_result_persist` records the tool result and, for failed results,
  returns a replacement tool-result message whose visible text content has SEKB
  historical error advice appended.
- `agent_end` finishes the trajectory as success or failure.
- Aborted OpenClaw runs are represented by `agent_end` with `success: false`
  and no error; SEKB records those as partial. Custom adapter targets may still
  emit `abort` through `subscribe(...)` for the same partial outcome.

SEKB hook failures are swallowed and reported through the optional `onError`
callback so knowledge capture cannot break the agent run.

No v0.2 path pauses tools, retries work, blocks tool calls, silently rewrites
tool output, or writes L2 principles without `DistillationTool.confirm_and_save()`.

## Manual Distillation

MVP distillation is explicit:

```ts
const suggestions = distiller.suggest_principles_from_trajectories(null, 2);
const principleId = distiller.confirm_and_save(suggestions[0], {
  action: "Prefer the verified operator runbook before editing code",
});
```

`confirm_and_save` stores an active L2 principle, marks source trajectories as distilled, and sets their expiry to 90 days after confirmation. `reject_suggestion` records the rejection reason for later prompt or distillation tuning.

## Storage

The shared state schema adds:

- `sekb_trajectories`
- `sekb_principles`
- `sekb_error_signature_cache`
- `sekb_distillation_rejections`

Embeddings are stored as nullable JSON arrays. When embeddings are missing, retrieval uses deterministic lexical scoring over task intent, task type, tags, error signatures, and principle content.

The L1 index is derived from active L2 principles and bounded to an approximate 2K-token budget.

## Operator Report

`buildSekbOperatorReport(store)` returns a read-only snapshot for manual
distillation review. It includes total trajectory counts, undistilled
trajectory summaries, active principle summaries, and the current L1 index
preview. The report does not write principles, reject suggestions, or mark
trajectories distilled.

## Runtime Integration Verification

The focused integration proof for runtime owners is:

```powershell
cd openclaw_runtime
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts src/knowledge/sekb/sekb.test.ts
```

The `installSekbHarnessHooks` coverage uses the real OpenClaw plugin hook
runner event shapes for `before_agent_start`, `before_tool_call`,
`tool_result_persist`, and `agent_end`. It verifies that task advice is visible
context, error advice is appended to visible tool-result content, tool calls and
results become L3 trajectory steps, error signatures are persisted, success and
failure finish states are recorded, abort fallback records partial, and SEKB
hook failures only reach optional `onError`.

## Stage 2 Decisions

The MVP leaves these decisions open:

- Distillation trigger policy: manual, scheduled, or trajectory-count threshold.
- Verifier model policy: independent LLM or the same model with different parameters.
- Curator scoring: evaluation cadence and weights for retrieval, adoption, and post-adoption success.

README translation updates are not required for v0.2 because the branch adds
runtime-side explicit hook integration and a read-only operator report, with no
new renderer page, visible navigation, or end-user desktop workflow.

## Long Task Continuation

Future `/goal` work should start from
`harness/specs/tasks/sekb-runtime-long-task-development.md`. That task spec
links the SEKB development-loop rule, stage guide, roadmap, required tests, and
closure gates so long-running agents do not invent a parallel plan.

The recommended next package is runtime integration closure: prove the explicit
SEKB hook adapter against real runtime hook/event shapes, keep the integration
default-off and advisory, and update docs with the exact enablement and proof
workflow.
