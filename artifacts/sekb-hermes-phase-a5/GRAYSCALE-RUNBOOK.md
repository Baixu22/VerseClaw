# SEKB Hermes Tier B Grayscale Runbook

Authority: offline evaluation / ops evidence only. Not a runtime source of truth.
Scope: **capture + report only**. No Phase C/D, no ambient batch LLM, no auto principle / ContextBlock writes.

## Goals

- Explicitly opt-in SEKB master (+ optional shadow) on internal / canary installs
- Capture trajectories into the shared Host/Gateway state DB
- Export / protocol / report without claiming promotion benefit
- Roll back instantly by turning flags off

## Flag scheme (docs + config only; no GUI)

| Flag | Path / env | Tier B default | Notes |
|------|------------|----------------|-------|
| Master | `runtime.contextBlock.sekb.enabled` / `OPENCLAW_SEKB_ENABLED` | **off** in production; **on** only for opt-in grayscale | Nested flags alone cannot enable capture |
| Shadow metadata | `runtime.contextBlock.sekb.shadowEvaluation.enabled` / `OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED` | optional on during grayscale | Requires master |
| Batch assistant | `runtime.contextBlock.sekb.batchDistillationAssistant.enabled` / `OPENCLAW_SEKB_BATCH_DISTILLATION_ASSISTANT_ENABLED` | **keep false** | Explicit invoke only; not part of Tier B |
| Capture filtering (Phase D) | n/a | **forbidden** | Do not activate |
| Scheduler (Phase C) | n/a | **forbidden** | Do not activate |

Human durable write path remains: `confirm_and_save` only.

## State directory alignment

`pnpm dev` / Electron Host and CLI ops must share:

- Windows: `%APPDATA%\\Electron\\openclaw-source-state`
- Override: `OPENCLAW_STATE_DIR`

Do **not** assume `~/.openclaw` is the active Gateway DB under Electron.

Verify:

```bash
pnpm sekb:a5:inventory
# export count must equal sqlite sekb_trajectories for the Electron state dir
```

## Enable (opt-in)

```bash
# Inventory only (does not mutate flags)
pnpm sekb:a5:inventory

# Enable master + shadow on Electron state config only; batch stays false
pnpm sekb:grayscale:enable
# equivalent:
# node scripts/sekb-enable-shadow-local.mjs --enable --target electron

# Optional: also pass --enable-sekb-shadow to configure-deepseek-runtime
# (configure-deepseek does NOT enable SEKB unless that flag is present)
```

Env overrides (process-local, highest priority when set):

```bash
OPENCLAW_SEKB_ENABLED=1
OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED=1
# leave batch unset/false
```

## Capture traffic

Real tasks (preferred for grayscale):

1. Keep flags on for N days or until >= 100-300 real task trajectories
2. Operators chat / run agents normally; trajectories land in `sekb_trajectories`

Local smoke only (not dual-review labels):

```bash
node scripts/sekb-shadow-capture-smoke.mjs --count 10
# requires DEEPSEEK_API_KEY; writes smoke trajectories with explicit scenario task_types
```

## Export / protocol / report

```bash
# Evidence pack: inventory + export + unfilled protocol/report + status JSON
pnpm sekb:grayscale:observe
# or:
# node scripts/sekb-grayscale-observe.mjs --sample-size 20 --key <local-pseudonymization-key>

# Manual ops surface
pnpm sekb:hermes:export -- --key <local-key>
pnpm sekb:hermes:protocol -- --key <local-key> --sample-size 40
# Fill dual reviews ONLY with humans for Tier C; do not fabricate labels
pnpm sekb:hermes:report -- --reviews <path> --export <export> --protocol <protocol> --reviewers A,B
```

Automated dual-smoke (pipeline only):

```bash
pnpm sekb:a5:auto-test -- --count 0 --skip-capture
# labelAuthority=automated_smoke_not_human; never sets evaluable_for_promotion
```

## What to record each observation window

- trajectory growth (sqlite count + export match)
- task_type / context_tags distribution (watch agent/task collapse on real traffic)
- shadow score buckets + retain ratio (high retain is expected; capture value != task success)
- sqlite file size and any Host/CLI latency complaints
- operator report evidence state: disabled / unavailable / unknown / insufficient_data / ready
- privacy: export remains keyed-pseudonymous; no intent/tags/raw tool/prompt/secret/diff; shadow metadata <= 2KiB

## Rollback

```bash
pnpm sekb:grayscale:disable
# or env:
# OPENCLAW_SEKB_ENABLED=0
```

Flag-off expectations:

- no ambient capture
- no shadow metadata writes
- no batch evidence writes
- Host/CLI export may still read historical rows for offline evaluation

## Risks

| Risk | Mitigation |
|------|------------|
| State-dir split-brain (Electron vs ~/.openclaw) | Always set/export with OPENCLAW_STATE_DIR; inventory both |
| Inventory script accidentally enabling SEKB | Inventory is default-off; require `--enable` |
| Fake dual-review for promotion | Campaign status forces evaluable_for_promotion=false for automated labels |
| Shadow retain~100% misread as success | Document capture value != task success; no V1 retune in Tier B |
| Batch / Phase C/D creep | Keep nested batch false; never ship filtering/scheduler |

## Success criteria checklist

1. [x] Flag-on: export count == sqlite sekb_trajectories (same state dir)
2. [x] Flag-off parity: nested flags alone cannot enable; env 0 overrides config
3. [x] Privacy-bounded export; shadow metadata <= 2KiB
4. [x] Operator/offline report honest states (no fabricated acceptance/edit-distance)
5. [~] Continuous grayscale days / >=100 trajectories (local canary met count floor; multi-day production canary still recommended)
6. [x] Evidence under artifacts/sekb-hermes-phase-a5/
7. [x] This runbook

Promotion remains **shadow_only**.
