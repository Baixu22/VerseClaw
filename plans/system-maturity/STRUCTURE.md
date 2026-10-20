# System Maturity Structure

本目录按四个层次组织。规划结构、实时状态和证据治理必须各归其位，避免复制出第二真源。

| 层 | 单一职责 | 权威文件 | 生成或校验 |
|---|---|---|---|
| 入口层 | 解释规则、合法状态、交付格式和导航 | `README.md`, `STRUCTURE.md` | 文档审阅；结构校验检查链接与目录 |
| 拓扑层 | 固定阶段顺序、负责人、Finding 与阶段依赖 | `phases.json` | `maturity:plan` 校验 PLAN/STATUS 一致性 |
| 执行层 | 每个阶段的计划、任务、依赖、验收和 delivery | `phase*/PLAN.md`, `tasks/*`, `*.delivery.md` | `maturity:plan` + `maturity:evidence` |
| 证据层 | Finding、风险接受、residual、gates 与可追溯证据 | `findings-registry.json`, `risk-acceptance.json`, `residual-register.json`, `gates.json`, `artifacts/system-maturity/**` | 对应 maturity 脚本；证据哈希以 committed blobs 为准 |

## 状态所有权

- 任务和阶段状态只写在各阶段 `STATUS.json`。
- `INDEX.md` 是状态投影，不得手工改变 Status 列；运行 `pnpm maturity:sync-index` 从 `STATUS.json` 重建。
- `phases.json` 不保存 done/in_progress/blocked；它只保存稳定拓扑和导航元数据，避免把进度复制出第二真源。
- `findings-registry.json` 拥有 Finding 的治理状态；`risk-acceptance.json` 与 `residual-register.json` 拥有到期复核和残余接受，不是任务状态的替代品。
- `plans/system-maturity/` 是执行中的门禁配置与规范，不是历史归档目录。历史产物只有在被 inventory 明确保留后才进入 Git。

## 阶段结构

<!-- BEGIN GENERATED PHASE TABLE -->
| # | Phase | Tier | Owner | Findings | Dependencies | Status |
|---|---|---|---|---|---|---|
| 1 | `phase0-foundation` | M0→M1 | program-governance | F-GOV-001, F-GOV-002, F-GOV-003, F-REL-004 | none | done |
| 2 | `phase1-direct-boundaries` | M1→M2 | main-boundary | F-SEC-001, F-SEC-002, F-SEC-003, F-SEC-004, F-SEC-005, F-SEC-006, F-SEC-007, F-SEC-010 | phase0-foundation | done |
| 3 | `phase2-authorization-isolation` | M2→M3 | runtime-auth | F-AUTH-001, F-AUTH-002, F-AUTH-003, F-AUTH-004, F-AUTH-005, F-AUTH-006, F-ISO-001, F-ISO-002, F-REL-003 | phase1-direct-boundaries | blocked |
| 4 | `phase3-data-authority` | M3→M4 | data-governance | F-DATA-001, F-DATA-002, F-DATA-003, F-DATA-004, F-DATA-005 | phase2-authorization-isolation | done |
| 5 | `phase4-runtime-surfaces` | M4→M5 | runtime-surfaces | F-AUTH-008, F-AUTH-009, F-SEC-007, F-REL-003, F-DATA-004 | phase2-authorization-isolation, phase3-data-authority | done |
| 6 | `phase5-reliability-abuse` | M5→M6 | reliability | F-REL-001, F-REL-002, F-REL-005, F-UX-001, F-GOV-001 | phase0-foundation, phase2-authorization-isolation | done |
| 7 | `phase6-supply-release` | M6→M7 | supplychain-release | F-SUPPLY-001, F-SUPPLY-002, F-GOV-003 | phase0-foundation, phase5-reliability-abuse | in_progress |
| 8 | `phase7-continuous-governance` | M7→continuous | program-governance | F-GOV-001, F-GOV-002, F-GOV-003, F-UX-002 | phase6-supply-release | done |
| 9 | `phase8-residual-closure` | M8→residual | program-governance | F-SEC-001, F-REL-004, F-DATA-004, F-GOV-002 | phase7-continuous-governance | done |
<!-- END GENERATED PHASE TABLE -->

## 依赖解释

阶段依赖按 `phases.json` 的 `dependencies` 检查。任务依赖按各任务文件的 `Depends on` 检查；阶段级依赖只说明是否满足该阶段的入口条件，不把下游已完成任务的历史证据自动升级为当前验收。

`phase2-authorization-isolation` 当前为 `blocked`（P2-005 的生产 CVK 执行边界未闭环），同时 P3/P4/P5 已有历史 delivery。这是“上游仍有残余、下游已有历史工作”的事实组合，不是依赖通过的证明；发布判断必须以季度审计、风险接受与 release gates 的实际结果为准。

`scripts/lib/system-maturity-quarterly-audit.mjs` 中的 `PHASE_DIRS` 是为历史证据哈希保真的冻结兼容面；新增的 `system-maturity-phase-order-guard.test.ts` 会阻止它与 `phases.json` 漂移。新的结构消费者应直接读取 `phases.json`。

## 变更流程

1. 修改拓扑：编辑 `phases.json` 与对应 `PLAN.md`，运行 `pnpm maturity:plan`。
2. 修改状态：只改 `STATUS.json` 和任务/delivery 证据，运行 `pnpm maturity:sync-index` 与 `pnpm maturity:validate`。
3. 修改导航：更新本文件或 `README.md`，不要复制会漂移的实时任务数或状态快照。
4. 需要保留新证据：先加入 `scripts/repository-artifacts.json` 的 reviewed inputs，再运行 `pnpm repo:artifacts:check`。
