# ClawX System Maturity Program

## Purpose

本目录定义 Verse Claw 的系统成熟度控制面：阶段拓扑、可执行任务、Finding 治理、证据门禁和发布资格。结构分层见 [STRUCTURE.md](./STRUCTURE.md)，阶段状态总览见 [INDEX.md](./INDEX.md)。

## Rules

1. Phase 顺序由 [phases.json](./phases.json) 固定，按依赖推进。
2. 每个任务必须绑定审计 Finding、Owner、Reviewer、Tests 和 Acceptance。
3. 任务只有在全部 Acceptance 通过且证据已写入 hash-addressed delivery 后才能标记 `done`。
4. 阶段只有在全部任务为 `done` 后才能标记 `done`。
5. 非 `done` 状态必须记录真实缺口或外部阻断；阻断不等于完成。
6. 发布前必须通过 phase0、phase1、phase2、phase6、phase7，并满足 phase8 residual gate 与季度风险接受。
7. 任务交付格式见 [DELIVERY-FORMAT.md](./DELIVERY-FORMAT.md)。

## Status values

### Task status

- todo
- in_progress
- blocked
- done

### Phase status (`STATUS.json.phaseStatus`)

- planned
- in_progress
- blocked
- done

Task status and phase status are separate enums. `phaseStatus=done` is allowed only when every task in that phase is `done`.

## Authority and projections

- `phases.json` owns the stable phase topology (order, owner, dependencies, Finding scope).
- Each `phase*/STATUS.json` owns live task and phase status.
- `INDEX.md` is generated status projection; use `pnpm maturity:sync-index`.
- `findings-registry.json`, `risk-acceptance.json`, and `residual-register.json` own Finding and residual governance.
- `gates.json` owns daily, PR, and release gate definitions.
- `STRUCTURE.md` documents the four layers and their ownership boundaries.

## Execution

执行顺序、worktree 并行边界、串行依赖和首个启动任务见 [EXECUTION-ORDER.md](./EXECUTION-ORDER.md)。AI 执行模板见 [AI-EXECUTION-PROMPTS.md](./AI-EXECUTION-PROMPTS.md)。

## True-close rules (mandatory)

1. A task may be marked `done` only when its harness (if any) passes on the **committed** tree, not only mid-collection.
2. Delivery `TESTS` must match the commands recorded in that task's full-validation evidence; silent gate downgrades are forbidden.
3. `INDEX.md` Status must match each phase `STATUS.json.phaseStatus` (run `pnpm maturity:sync-index` before seal).
4. After any `maturity:validate` rewrite of reports, run `pnpm maturity:seal` so delivery hashes stay consistent.

## Phase 8 extension

Phase 8 residual-closure starts only after phase7 is done. It governs Partial+Act-now residuals that escaped earlier risk-acceptance policy.
