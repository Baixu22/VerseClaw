# ClawX System Maturity Program

## Rules

1. Phase 顺序固定：phase0 → phase7。
2. 每个任务必须绑定审计 Finding、Owner、Reviewer、Tests、Acceptance。
3. 任务只有在所有 Acceptance 通过且证据已写入 manifest 后才能标记 done。
4. 阶段只有所有任务为 done 才能标记 done。
5. blocked 必须记录外部阻断；blocked 不等于 done。
6. 任何发布前必须通过 phase0、phase1、phase2、phase6、phase7。
7. 任务交付格式见 DELIVERY-FORMAT.md。

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


## Status files

STATUS.json 只保存 phaseStatus、task status、allTasksDone，不写解释。

## Execution

执行顺序、worktree 并行边界、串行依赖和首个启动任务见 [EXECUTION-ORDER.md](./EXECUTION-ORDER.md)。
