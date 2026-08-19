# Coding Runtime 开发规范文档（Development Specification）

> 状态：Phase 0-5 已全量验收（ACCEPT_WITH_RESIDUAL）；**Phase 6 已收卡（2026-08-18，verdict 均 ACCEPT_WITH_RESIDUAL）；Phase 7 已实现并通过独立验收（verdict=ACCEPT_WITH_RESIDUAL），待用户确认收卡**。实施规范见 `docs/dev/coding-runtime-p6-p7-development-spec.md`。
> 日期：2026-08-16
> 适用范围：ClawX / OpenClaw 编码能力增强，后续开发任务必须参考本文档作为需求、设计、验收的单一依据。
> 关联文档：`reports/CODING-CAPABILITY-DEV-PLAN-2026-08-16.md`

---

## 1. 背景

ClawX/OpenClaw 已经具备大量 coding 能力组件：`edit` / `write` / `apply_patch`、write-journal、undo_write、checkpoint rollback、per-file mutation queue、session write lock、exec/process 全生命周期、event-log 与 observability。

但这些组件彼此独立，导致：

1. 写、编辑、删除、移动的 journal/回滚语义不统一。
2. shell 执行产生的文件副作用没有进入文件事务与审计。
3. 审计事件分散，无法按 coding 操作回放。
4. 并发写有队列，但缺少统一的“版本 + 冲突检测”抽象。

本规范定义一次受控的编码能力增强工程，目标是建立 **Unified File Transaction & Audit Kernel（UFTK）**，在不重复造轮子的前提下补齐上述缺口。

---

## 2. 目标

### 2.1 业务目标

- 让所有文件 mutation（write / edit / apply_patch / delete / move）具有统一、可回滚、可审计、可并发控制的行为。
- 让 shell 执行具备命令级审批、副作用审计、可查询的变更清单。
- 提供按 session 回放 coding 操作（mutation / exec / rollback）的能力。

### 2.2 技术目标

- 建立 `shared/coding-runtime/*` 类型与 schema 契约。
- 建立 `openclaw_runtime/src/agents/coding-runtime/*` 统一服务层。
- 保持现有 `write-journal`、`apply-patch-preflight`、`checkpoint-rollback`、`file-mutation-queue`、`session-write-lock` 为底层实现，不推倒重来。
- 所有新能力默认 fail-closed；未完成验收前不得开启产品默认路径。

---

## 3. 非目标（Non-Goals）

为避免过度设计，以下内容**不纳入**本规范：

- 不做浏览器能力。
- 不做 subagent / 多智能体编排。
- 不做上下文管理与任务规划。
- 不做模型适配层、UI 重设计。
- 不实现完整 OS 级沙箱（现有 VerseShell / sandbox 能力继续负责）。
- 不实现 shell 外部副作用的“完全回滚”（网络请求、远端 push、数据库写入、依赖安装等无法可靠回滚）。
- 不新增一套与现有 `write-journal` / `event-log` 并行的“第二真源”；只做整合与补洞。
- 不追求 100% 文件系统事件捕获；只保证通过 UFTK 工具面发生的 mutation 可审计可回滚。

---

## 4. 范围

| 范围 | 包含 | 不包含 |
|---|---|---|
| 文件处理 | write / edit / apply_patch / delete / move 的 preflight、snapshot、commit、rollback | 浏览器、subagent、上下文 |
| Shell 运行态 | exec/process 审批、超时、输出有界、side-effect 清单 | OS 级沙箱重写 |
| 可观测审计 | mutation/exec/rollback 结构化事件、JSONL + SQLite 索引、查询/回放 | 产品级 Dashboard 完整设计 |
| 并发读写 | 文件级 RW lock、乐观版本冲突检测、跨进程锁、atomic write | 分布式文件系统 |

---

## 5. 开发约束与原则

1. **复用优先**：必须复用现有 `write-journal.ts`、`apply-patch-preflight.ts`、`checkpoint-rollback-executor.ts`、`file-mutation-queue.ts`、`session-write-lock.ts`、`coding-observability.ts`。
2. **单一职责**：UFTK 只做“统一事务 + 审计 + 并发协调”，不接管模型工具 schema、不重写 shell 执行内核。
3. **Fail-closed**：任何契约、版本、锁、审计写入失败都不得静默放行写操作；宁可失败，不可产生不可追踪的变更。
4. **默认关闭**：新能力通过 flag 控制，默认 `false`；未完成验收不得 flip。
5. **小步交付**：每个 Phase 必须有独立测试与验收，不允许一次性大爆炸提交。
6. **不引入第二真源**：JSONL 审计日志是事件流记录，不是文件状态真源；文件状态真源始终是文件系统 + write-journal。
7. **兼容现有工具调用**：已有 `write` / `edit` / `apply_patch` 工具的外部参数格式不变，只改内部实现路径。
8. **跨平台**：Windows / macOS / Linux 文件锁语义不同，锁实现必须带超时、owner、stale 检测。

---

## 6. 执行方案

### Phase 0：契约与审计模型（1 周）

**交付物**
- `shared/coding-runtime/types.ts`
- `shared/coding-runtime/schema.ts`
- 事件类型：`CodingMutationEvent` / `CodingExecEvent` / `CodingRollbackEvent`
- 版本类型：`FileVersion = { path, contentHash, mtimeMs, size }`
- 统一 mutation 接口：`prepare / commit / rollback / listAudit`

**验收**
- [x] 所有类型通过 TypeBox/Zod schema 校验。
- [x] 事件字段包含 `sessionId`、`requestId`、`toolName`、`path`、`beforeHash`、`afterHash`、`timestamp`。
- [x] 新旧字段有迁移说明。

**P0 补充产物**
- `shared/coding-runtime/README.md` — 契约不变量与验证命令。
- `shared/coding-runtime/MIGRATION.md` — write-journal / exec / rollback 旧字段到 v1 事件的迁移说明。
- `tests/unit/coding-runtime-contract.test.ts` — TypeBox 校验、字段必填、事件族判别与默认关闭门禁。

### Phase 1：统一文件事务引擎（2 周）

**交付物**
- `openclaw_runtime/src/agents/coding-runtime/file-transaction-service.ts`
- 扩展 `write-journal.ts`：delete / move pre-image
- 统一 IO 层：编码/换行/atomic write（temp + fsync + rename）
- `previewRollback(batchId)`：回滚前 diff 预览

**验收**
- [x] write / edit / apply_patch / delete / move 全部进入统一 journal。
- [x] 每个 mutation 可单独回滚，也可按 batch 回滚。
- [x] 回滚前 `previewRollback` 返回统一 diff。
- [x] 非 git 项目可完整回滚。
- [x] 原子写失败不会留下半文件。

### Phase 2：并发读写与冲突检测（2 周）

**交付物**
- `openclaw_runtime/src/agents/coding-runtime/file-lock-manager.ts`
- 扩展 `file-mutation-queue.ts`：读共享 / 写互斥
- `TurnDiffTracker` 风格增量 diff
- 乐观版本参数 `baseVersion` 与冲突错误 `E_CONFLICT`

**验收**
- [ ] 同一文件并发读不互斥。
- [ ] 同一文件并发写串行。
- [ ] 基于过期版本写入返回 `E_CONFLICT` + diff，不覆盖。
- [ ] 跨进程同文件写有锁（复用 session-write-lock / SQLite lock）。
- [ ] 写文件统一 atomic write。

### Phase 3：Shell 副作用审计与命令级审批（2 周）

**交付物**
- `openclaw_runtime/src/agents/coding-runtime/exec-audit.ts`
- `openclaw_runtime/src/agents/coding-runtime/command-approval-policy.ts`
- `bash-tools.exec.ts` 接入 exec 前后文件指纹快照
- 命令前缀级 `Allow / Prompt / Forbidden`

**验收**
- [ ] 每次 exec 产生 `CodingExecEvent`。
- [ ] exec 前后工作区文件指纹可生成 side-effect 清单。
- [ ] 命令审批支持前缀 token 规则。
- [ ] 审批事件、exec 事件、side-effect 事件写入统一审计流。
- [ ] 不改变现有 `exec` 工具对外参数。

### Phase 4：可观测审计与会话回放（2 周）

**交付物**
- `openclaw_runtime/src/agents/coding-runtime/audit-log.ts`
- `openclaw_runtime/src/agents/coding-runtime/audit-index.ts`
- `openclaw_runtime/src/agents/coding-runtime/replay.ts`
- 查询 API：按 session / 时间 / 工具 / 文件 / 命令过滤

**验收**
- [ ] 新会话 coding 事件全部落盘（JSONL）。
- [ ] SQLite 索引可查询，数据可从 JSONL 重建。
- [ ] 回放顺序与真实执行一致。
- [ ] 事件不包含敏感原始命令明文（可按策略脱敏）。

### Phase 5：Git-backed Checkpoint（1 周，可选）

**交付物**
- `openclaw_runtime/src/agents/coding-runtime/git-checkpoint.ts`
- Cline-style `git stash create` + 私有 ref + restore transaction
- restore 互斥锁

**验收**
- [ ] git 项目可 checkpoint / restore。
- [ ] 非 git 项目不受影响。
- [ ] 并发 restore 安全。
- [ ] 嵌套 .git / submodule 场景有明确降级策略，不允许静默丢失。


### Phase 6 / Phase 7 扩展（2026-08-18 用户授权，新范围）

> 本文件 Phase 0-5 是原计划并已完成验收。Phase 6/P7 是用户明确授权的新增范围：
> - P6 = 并发锁统一/硬化（P6A）+ Git Checkpoint v2（P6B），挂 `TF-0075` —— **已 done**。
> - P7 = 工作流级扩展（C），挂 `TF-0076`，依赖 P6 完成 —— **已实现 + 独立验收完成，待用户确认**。
> 实施细节、验收矩阵、flag 规划、性能预算与硬性禁止以
> `docs/dev/coding-runtime-p6-p7-development-spec.md` 为单一实施依据；
> Harness 执行契约为 `harness/specs/tasks/coding-runtime-p6-p7-extension.md`。
> P6/P7 所有新能力默认关闭，未验收前不得接入生产路径或改变模型 schema。
> 截至 2026-08-18：P6/P7 共新增 6 个 flag（P6A `concurrencyV2`；P6B `gitCheckpoint.pathScoped` / `.safetySnapshot` / `.lifecycle`；P7 `execUndo` / `autoCheckpoint`），shared flag 数 6 → 12，全部默认 `false`；除 `E_GIT_CHECKPOINT_RECOVERY_REQUIRED` 一个结构化错误码外未新增模型可见 schema（P7 未新增任何错误码）；**P7 三个模块尚无任何生产调用方**，接线需另行授权。

---

## 7. 验收方案（最重要）

### 7.1 验收层级

| 层级 | 内容 | 工具/命令 |
|---|---|---|
| L1 单元测试 | schema、journal、lock、diff、rollback、approval policy | `vitest` |
| L2 集成测试 | 工具接入 UFTK 后 write/edit/apply_patch 行为不变 | `vitest` / 真实 binary |
| L3 黑盒测试 | 真实文件系统上的回滚、冲突、并发、审计落盘 | 脚本 + `ae.exe` / Node |
| L4 回归门禁 | 全量 VerseShell / coding 相关测试 | `pnpm verseshell:test` |
| L5 工程控制面 | Agent Dev / maturity 证据 | `pnpm agent-dev:audit` |

### 7.2 强制验收项

每个 Phase 合并前必须满足：

1. **功能验收**
   - [ ] 该 Phase 所有交付物存在且被测试覆盖。
   - [ ] 现有 `write` / `edit` / `apply_patch` 对外 schema 不变。
   - [ ] 未引入新的默认开启行为。

2. **回滚验收**
   - [ ] 构造“写入 → 修改 → 回滚”场景，回滚后文件内容与写入前完全一致。
   - [ ] 删除文件后可恢复。
   - [ ] 移动文件后可恢复原路径与内容。
   - [ ] 回滚失败时返回结构化错误，且不破坏 journal。

3. **并发验收**
   - [ ] 两个并发写同一文件：一个成功，另一个要么等待串行成功，要么返回 `E_CONFLICT`，不允许互相覆盖。
   - [ ] 并发读不阻塞。
   - [ ] 跨进程锁在 Windows / Linux 上至少各验证一次。

4. **审计验收**
   - [ ] 每次 mutation 至少一条结构化事件。
   - [ ] 每次 exec 至少一条结构化事件 + side-effect 清单（如有变化）。
   - [ ] 事件可按 session 回放。
   - [ ] 事件落盘失败时，mutation 默认失败（fail-closed），或明确降级并记录 warning（需在设计中声明）。

5. **性能验收**
   - [ ] 单文件 write/edit 延迟增加不超过可接受阈值（建议 < 20% 或 < 50ms，以 baseline 为准）。
   - [ ] 大文件（≥ 1MB）apply_patch 不出现 O(n²) 明显退化。
   - [ ] 审计日志写入采用异步/批量，不阻塞主工具调用（或明确接受同步写入的代价）。

### 7.3 回归命令

```bash
# 类型与契约
pnpm contract:check
pnpm run typecheck

# 单元/集成
pnpm exec vitest run tests/unit/coding-runtime-*.test.ts --maxWorkers=1

# 全量 VerseShell 门禁
pnpm verseshell:test

# 工程控制面
pnpm agent-dev:audit
```

### 7.4 Definition of Done

一个开发任务只有在以下全部满足时才可视为完成：

- [ ] 代码已实现，且有对应单测/集成测试。
- [ ] 新增/修改文件已通过 lint、typecheck、contract check。
- [ ] 所有强制验收项（7.2）通过。
- [ ] 文档已更新：`docs/dev/coding-runtime-development-spec.md`、相关 README。
- [ ] 未破坏现有 `pnpm verseshell:test`。
- [ ] 默认 flag 仍为关闭（除非该任务明确获得 flip 许可）。

---

## 8. 过度设计防护（Over-engineering Guard）

1. 不引入新框架 / 新数据库 / 新消息总线。
2. 不建立与现有组件平行的“第二套事务系统”。
3. 不在 Phase 0 就设计完整 UI。
4. 不把 shell 外部副作用回滚做成通用事务。
5. 不为尚未出现的需求增加抽象层；每个抽象必须有至少两个真实调用方。
6. 若某个功能在 Phase 验收中无法证明价值，则砍掉或降级为可选。

---

## 9. 缺斤少两防护（Under-delivery Guard）

1. 每个 Phase 的“交付物”和“验收”必须一一对应，不允许只交付代码不交付测试。
2. 回滚验收必须覆盖：新建文件、修改文件、删除文件、移动文件、批量 apply_patch。
3. 并发验收必须覆盖：同进程、跨进程、读读、写写、读写。
4. 审计验收必须覆盖：mutation、exec、rollback、审批、冲突错误。
5. 禁止用“已有能力近似”代替新契约；必须显式接入 UFTK。

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 与现有 write-journal 语义冲突 | 回滚不一致 | Phase 1 先做契约审计，再改实现 |
| Windows 文件锁不可靠 | 并发写覆盖 | 锁文件 + owner + stale + 超时；跨平台测试 |
| 审计日志过大 | 磁盘膨胀 | JSONL 分层目录 + 压缩策略 + SQLite 索引裁剪 |
| shell 副作用捕获成本高 | 性能下降 | 只对工作区做增量指纹，不做全盘扫描 |
| 默认开启风险 | 用户工作区被意外回滚 | 所有能力默认关闭，显式 opt-in |
| 过度设计 | 交付延迟 | 严格执行 Non-Goals 与 Over-engineering Guard |

---

## 11. 里程碑建议

| 里程碑 | 内容 | 退出条件 |
|---|---|---|
| M1 | Phase 0 + Phase 1 | 统一事务可回滚，单元/集成测试绿 |
| M2 | Phase 2 | 并发读写与冲突检测绿 |
| M3 | Phase 3 | shell 副作用审计 + 命令级审批绿 |
| M4 | Phase 4 | 审计日志 + 回放 API 绿 |
| M5 | Phase 5（可选） | git checkpoint 绿 |
| M6 | Phase 6（A+B，新授权） | **已达成（2026-08-18）**：并发锁统一/硬化 + Git Checkpoint v2 全绿；验收修复 3 缺陷（层级 writer barrier 失效、亚毫秒争用不计数、超覆盖范围 scope 删除内容） |
| M7 | Phase 7（C，新授权） | **已达成、待确认（2026-08-18）**：exec 文件副作用撤销 + worktree bridge + 自动 checkpoint 全绿（27 files / 240 tests）；承接 A/B/C/D 全部落地；验收修复 3 缺陷（bridge barrier 泄漏、gitignored 副作用路径、retention 秒级排序可删最新 checkpoint） |

---

## 12. 结论

本规范为后续所有 coding 能力开发任务提供统一背景、目标、执行方案和验收标准。所有开发必须在此约束内进行：**复用现有组件、默认关闭、小步交付、验收优先、避免过度设计、不缺斤少两**。
