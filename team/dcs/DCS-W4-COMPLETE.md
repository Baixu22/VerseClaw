# DCS W4 COMPLETE — D4 SEKB experience bridge to production path

**Date**: 2026-07-14  
**Window**: W4 (DCS wiring repair)  
**Commit message**: `feat(runtime): connect sekb experience bridge to production path`

## Goal

Stop treating SEKB as a test-only island:

1. Explicit enable (config/env) installs `installSekbHarnessHooks` on the production embedded extension bus.
2. Production-shaped `confirm_and_save` can pass `{ contextBlockSink, sessionId }` so experience Blocks write back.
3. When SEKB is enabled, terminal `trajectoryCapture` is a real instance on task-state handler config (W1 handoff).

## production wiring status: sekb-partial-live

SEKB is default-off and flag/env gated. When enabled on embedded attempt/compact:

- harness hooks install
- `trajectoryCapture` reaches `setTaskStateHandlerConfig`
- confirmed distillation can write experience via sink

Still not a full product surface: no Settings UI, no host-api distill action, no Electron E2E (W5), no workspace fingerprint / observability dashboard (W6).  
Remaining debt: **D3 D6 D7**.

## Enable surface (no UI)

| Surface | Location |
|---------|----------|
| Config flag | `runtime.contextBlock.sekb.enabled?: boolean` (default false) — `types.openclaw.ts`, `zod-schema.ts`, `schema.labels.ts`, `schema.help.ts` |
| Env override | `OPENCLAW_SEKB_ENABLED` = `true|1|yes|on` / `false|0|no|off` (env wins when set) — `sekb-runtime.ts` `isSekbEnabled` |

## Production call sites (file:line)

### A. install hooks

| Piece | Location |
|-------|----------|
| Factory | `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts:462` — `buildSekbFactory` |
| Install call | `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts:474` — `installEmbeddedSekbHarnessHooks(...)` |
| Factory registration | `openclaw_runtime/src/agents/embedded-agent-runner/extensions.ts:538` — `const sekbFactory = buildSekbFactory(params)` |
| Wrapper → real install | `openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.ts:102` — `installEmbeddedSekbHarnessHooks` → `installSekbHarnessHooks` |

Gate: `sekbRuntime` is only constructed when enabled (`resolveEmbeddedSekbRuntime`); factory installs only when that object is present (env-only enable still works).

### B. confirm_and_save production params

| Piece | Location |
|-------|----------|
| Production helper | `openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.ts:124` — `confirmAndSaveSekbExperience` |
| Passes sink+sessionId | `sekb-runtime.ts` third arg to `distiller.confirm_and_save(...)` when both present |
| FromRuntime no-op when off | `openclaw_runtime/src/agents/embedded-agent-runner/sekb-runtime.ts:150` — `confirmAndSaveSekbExperienceFromRuntime` |

ANTI-7 / ANTI-8 preserved: suggest path never writes Blocks; only `confirm_and_save` / production helper writes experience. Sink failure remains best-effort (existing DistillationTool behavior).

### C. trajectoryCapture wiring

| Piece | Location |
|-------|----------|
| Resolve when enabled | `openclaw_runtime/src/agents/embedded-agent-runner/dcs-extension-deps.ts:50` — `resolveEmbeddedSekbRuntime` |
| Attach capture + runtime | `openclaw_runtime/src/agents/embedded-agent-runner/dcs-extension-deps.ts:59-62` |
| Attempt resolve deps | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:1234` (`cfg: params.config`) |
| Attempt pass-through | `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts:2218-2219` |
| Compact resolve deps | `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts:853` |
| Compact pass-through | `openclaw_runtime/src/agents/embedded-agent-runner/compact.ts:1235-1236` |
| Task-state config set | existing `buildTaskStateFactory` → `setTaskStateHandlerConfig({ trajectoryCapture })` when provided |

## Tests

| File | What it proves if removed |
|------|---------------------------|
| `sekb-runtime.test.ts` | enable → install hooks + trajectoryCapture on task-state config; disable → no SEKB tool_call/agent_end; confirm helper writes experience via sink; disabled fromRuntime no-op; ANTI-8 suggest does not write |
| `runtime-context-block-sekb.test.ts` | typed default-off schema surface + labels/help + strict reject |
| `dcs-extension-deps.test.ts` | SEKB off → no trajectoryCapture / sekbRuntime leak |
| Existing sekb / experience-block / harness-integration | regression on bridge + hooks |

## Gate results (all exit 0)

| Gate | Command | Exit |
|------|---------|------|
| SEKB production wiring unit | `vitest.agents.config.ts` `sekb-runtime.test.ts` | **0** (1 file / 10 tests, ~11s) |
| SEKB / experience / harness unit | `vitest.unit.config.ts` experience-block-bridge + harness-integration + sekb | **0** (3 files / 26 tests, ~7s) |
| DCS suite | `pnpm run test:dcs` | **0** (~22s; unit 14/152 + runtime-config 5/10 + agents 10/57) |
| DCS lint (type-aware) | `pnpm run lint:dcs` | **0** |
| Typecheck | `pnpm run typecheck` | **0** (node + web) |

## Out of scope (unchanged)

- D6 / W5: Windows full-path Electron E2E
- D3 / W6: workspace fingerprint
- D7 / W6: dual-injection observability dashboard
- New Settings UI / i18n / host-api

## Residual debt

**D3 D6 D7**
