# Recommended Execution Order

## Start invariant

Do not silently replace canonical heads. Any baseline change requires a new governance task with fresh evidence.

1. 当前仓库存在用户 dirty changes；禁止 reset、clean、覆盖或批量搬运。
2. 规划文件所在工作树只保存规划与治理变更，不作为产品开发工作树。
3. 产品开发从 **product development head** `b1ff416dd162554f74e325fe77be5b5fba29387b`（P0-001 固化；审计证据仍锚定 `60061e33554311ac3c9871195210df59fe1b5bf2` + dirty patch）建独立 worktree；需要用户 dirty 变更时，只迁移明确文件并复核。
4. 每个 worktree 只允许一个活跃任务链；同一文件不得被两个 worktree 同时改动。
5. 每个 wave 合并后必须运行集成门禁，门禁通过后才更新 STATUS。

## Canonical baseline (frozen by P0-001)

| Role | SHA |
|---|---|
| **Product development head** | `b1ff416dd162554f74e325fe77be5b5fba29387b` |
| **Audit evidence head** | `60061e33554311ac3c9871195210df59fe1b5bf2` |
| **Branch reconciliation compared against** | `836a8e2dd4a7fa5f4e10a0948316f1a8a1d251b8` |

- Audit dirty patch (LF-normalized): `bf430bf565518462e04a84392e547ffe02656569a1a3be1c227073cc13d68e42` (833074 bytes)
- Machine-readable freeze: `plans/system-maturity/BASELINE.json`
- Phase topology: `plans/system-maturity/phases.json`
- Finding registry: `plans/system-maturity/findings-registry.json`
- Validator: `node scripts/audit-baseline-check.mjs` and `pnpm maturity:plan`

## Dependency order

```text
P0-001
  -> P0-002
      -> P0-003
      -> P0-004

P1-001
P1-002 -> P1-004 -> P2-005 -> P3/P4 integration
P1-003 -> P2-001

P2-001 -> P2-004
P2-002 -> P2-005
P2-003 -> P2-005

P3-001 -> P3-002 -> P3-003 -> P3-004

P6-001 -> P6-002
P6-003 -> P6-004 -> P6-005

P7-001 may start after P0; P7-002/P7-003 -> P7-004
P7-004 -> P8-001 -> P8-002/P8-003 -> P8-004
```

## Recommended waves

### Wave 0 - Control plane

Serial:

1. `P0-001`
2. `P0-002`
3. `P0-003`
4. `P0-004`

Exit: phase0 `STATUS.json.phaseStatus=done`.

### Wave 1 - Direct boundary tracks

Parallel in separate worktrees:

- `P1-001` Secret Broker
- `P1-002` Typed IPC / sender binding
- `P1-003` Files canonicalization
- `P6-001` Windows signing policy
- `P6-003` download integrity pinning
- `P7-001` Finding traceability

After `P1-002`: run `P1-004` in the same boundary worktree as `P1-002`.

### Wave 2 - Authorization kernel

Parallel after dependencies:

- `P2-001` after `P1-003`
- `P2-002` after `P0-002`
- `P2-003` after `P1-002`

Serial continuation:

1. `P2-004` after `P2-001`
2. `P2-005` after `P2-003` and `P2-004`

### Wave 3 - Data authority

Must be serial in one data worktree:

1. `P3-001`
2. `P3-002`
3. `P3-003`
4. `P3-004`

Reason: schema, lineage, redaction and delete cascade must share one authority model.

### Wave 4 - Runtime surfaces

After phase2 and required phase3 contracts:

- `P4-001` Gateway
- `P4-002` Browser
- `P4-003` MCP
- `P4-004` Channels

These may use separate worktrees, but each track is serial internally. Do not parallelize changes to shared host contracts or permission types.

### Wave 5 - Reliability

Recommended order:

1. `P5-001` atomic config writes
2. `P5-002` Cron single authority / lease
3. `P5-003` logger rotation and redaction
4. `P5-004` resource budgets

`P5-001` may start in parallel with Wave 1. `P5-003` waits for Phase 3 redaction contracts. `P5-004` waits for Phase 2 action gates.

### Wave 6 - Release trust

Parallel first layer:

- `P6-001`
- `P6-003`

Serial second layer:

- `P6-002` after `P6-001`
- `P6-004` after `P6-003`
- `P6-005` after `P6-002` and `P6-004`

### Wave 7 - Continuous governance

1. `P7-001` may start after phase0.
2. `P7-002` and `P7-003` run after the relevant runtime/data work is integrated.
3. `P7-004` is always last for the release cycle.

### Wave 8 - Residual closure

Serial after phase7 done:

1. `P8-001` Residual Act-now gate + channel secret residual locks
2. `P8-002` Channel secret broker vault (after P8-001)
3. `P8-003` Security capability inventory (after P8-001; may parallel P8-002 in separate worktree only if no shared schema edits)
4. `P8-004` Residual re-seal (after P8-001/P8-002/P8-003)

Exit: phase8 `STATUS.json.phaseStatus=done`.

## Worktree classification

### Safe to parallelize in separate worktrees

- `P1-001`, `P1-002`, `P1-003`
- `P5-001` with Wave 1
- `P6-001` and `P6-003`
- `P7-001` with product tracks
- `P4-001`, `P4-002`, `P4-003`, `P4-004` after shared contracts are frozen

Conditions:

- distinct file ownership
- no shared schema migration in progress
- no simultaneous edits to `shared/host-api/contract.ts`, `src/lib/host-api.ts`, `electron/main/ipc/*`, permission stores or release manifests
- each worktree has its own branch and test artifacts

### Must be serial

- all Phase 0 tasks
- `P2-004` before `P2-005`
- `P3-001 -> P3-002 -> P3-003 -> P3-004`
- `P6-001 -> P6-002`
- `P6-003 -> P6-004`
- `P6-005` after all release prerequisites
- `P7-004` after all planned evidence exists

### Same worktree, serial development recommended

- Boundary worktree: `P1-001 -> P1-002 -> P1-003 -> P1-004` when one team owns the broker boundary.
- Authorization worktree: `P2-001 -> P2-002 -> P2-003 -> P2-004 -> P2-005`.
- Data worktree: all Phase 3 tasks.
- Runtime-surface worktrees: each P4 track internally serial.
- Reliability worktree: all P5 tasks.
- Supply-chain worktree: all P6 tasks.
- Governance worktree: all P7 tasks.

## Integration gate after every wave

```text
1. git diff --check
2. contract:check
3. targeted unit tests for changed Finding IDs
4. typecheck for changed project
5. relevant E2E / red-team / fault-injection test
6. update manifest evidence and task DELIVERY
7. set task STATUS=done only if all acceptance items pass
8. set phase STATUS=done only if every task is done
```

## Historical first start (superseded)

This section records how the program originally started; it is not the current status. Current status comes only from each phase `STATUS.json`, projected by `pnpm maturity:sync-index`.

```text
TASK_ID: P0-001
STATUS: in_progress
OWNER: program-governance
SCOPE: freeze HEAD, dirty patch, Finding registry, evidence hashes
TESTS: baseline validator + manifest hash check
DELIVERY: plans/system-maturity/DELIVERY-FORMAT.md
```

Do not start P1 product work until `phase0-foundation/STATUS.json` reports all four tasks as `done`.
