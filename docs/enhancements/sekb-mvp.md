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

## Stage 2 Decisions

The MVP leaves these decisions open:

- Distillation trigger policy: manual, scheduled, or trajectory-count threshold.
- Verifier model policy: independent LLM or the same model with different parameters.
- Curator scoring: evaluation cadence and weights for retrieval, adoption, and post-adoption success.

README translation updates are not required for this slice because no renderer workflow, visible desktop page, or user-facing navigation changed.
