# Stage 5–6 串行开发提示词（一次交付，串行推进）

> 用途：交付给开发 agent 的唯一入口。按顺序完成 Stage 5 → Stage 6，中间不交付、不停顿，
> 除非命中「停止条件」（见 §7）。本提示词内置「防返工清单」（§2），它是 Stage 3 / Stage 4
> 历次验收反复的教训沉淀，务必逐条执行——跳过任何一条都会导致重新验收。
>
> 单阶段初版 `STAGE5-DEV-PROMPT.zh-CN.md` / `STAGE6-DEV-PROMPT.zh-CN.md` 仅作背景参考；
> 本文件是 Stage 5–6 串行开发与交付的唯一执行入口。

## 0. 前置事实与环境

| 项 | 值 |
|---|---|
| 工作树 | `D:\verse_claw_worktree` |
| 分支 | `codex/context-control-plane-stage0` |
| 包管理 | pnpm 11.2.2 |
| 基线 HEAD | `f55201b22630d5c904f3105b2a9c8876ea5e889b`（`git rev-parse HEAD` 必须等于此值，全程不变） |
| 前置阶段 | Stage 0 / Stage 1 / Stage 2 均 `accept`；Stage 3 / Stage 4 已修复独立验收缺陷，视为已解锁 |
| 产品锁 | `defaultOn=false`、`liveReady=false`、`productApproved=false`，全程不得变更 |

- 不 commit、不 push、不建 PR；`git log` 不得出现新提交。
- 真实 provider / 真人任务证据需 owner 一次性临时 key；无 key 时 golden-run 用例用
  `it.runIf(Boolean(process.env.DEEPSEEK_API_KEY))` 跳过，**不得伪造 fixture、不得把 synthetic 当 E4**。
- 开发前先执行 §3 的「读必读材料 + 只读确认现状」，再写任何生产代码。

## 1. 总原则

1. **spec-driven**：每个 stage 先创建正式 `harness/specs/tasks/context-control-plane-stageN.md`，
   `pnpm harness context --spec ...` 与 `pnpm harness validate --spec ...` 均 PASS 后，才写生产代码。
2. **一个 stage 一个关注点**：Stage 5 未自验收通过，不得开始 Stage 6。
3. **防返工优先**：验收判定表（L 表）在 spec 里就要写全；每个 deny/reject 原因都要有对应测试；
   写完后以「独立探针」逐条自测（§2.5、§2.6）。
4. **先冻结再编码**：数值阈值、字段列表、owner 决策项，能在约束文档裁定的写进 spec
   `ownerDecisions`；不能裁定的写进 `blockedBy` 并停下等待 owner（参考 Stage 1 的 Q 项处理），
   **不自作主张**。

## 2. 防返工清单（Stage 3 / Stage 4 反复验收的教训，务必逐条执行）

以下每一条都曾在独立验收中造成 `blocked`；本次开发必须前置规避。

### 2.1 闸门状态必须消费真实字段
- Stage 4 反例：`deriveStage4CapabilityGrant` 未读 `approvalRow.state`，`state=approved` 未
  `execution_started` 的 row 仍派生 grant。
- 规则：任何「只在某状态允许」的逻辑，**必须读取真实状态字段**并 fail-closed，且用真实
  ledger/store 的 row 写测试（不能只用自造 fixture）。

### 2.2 schema 校验必须对齐 owner schema 的完整边界
- Stage 4 反例：`validateActor`/`validateScope` 只查非空，非法 policyDigest / identity /
  scope / toolCallId 仍返回 `ok:true`，产出无法过 `normalizeCapabilityGrant` 的对象。
- 规则：新逻辑若产出/消费既有契约对象，必须**复用 owner schema**（如
  `shared/types/context-control-plane/artifacts.ts` 的 `normalize*`）或逐项复刻其约束到边界：
  长度上限、非法字符正则、非负索引上限、换行、通配、时间戳格式。负向测试要覆盖
  「长度超限」「非法字符」「越界索引」「换行」「通配」「空值」六类，不只测空值。

### 2.3 事件类型与 payload 必须一致，actor 白名单必须 fail-closed
- Stage 3 反例：`working_context_proposal_rejected` 携带 `decision: accepted` 仍被投影成
  current；proposal actor 为 `system` 仍进 pending。
- 规则：枚举/事件类型与 payload 的语义一致性必须校验；actor/kind 等白名单字段非法值必须
  fail-closed 且给出可查询原因；投影的 parse-warning 映射要覆盖所有新增拒绝码。

### 2.4 链 / 祖先完整性：root-first 全链，逐级 missing/revoked/expired
- Stage 4 反例：委托链上非直接子节点的 issue/revoke 审计 actorChain 缺 root；只解析直接 parent。
- 规则：任何 delegation / 祖先 / 血缘链，必须**逐级解析到 root**；missing/revoked/expired/
  越界的任一级都 fail-closed；审计记录的 actorChain 必须是 root-first 全链（与 verify 路径一致）。
  测试要覆盖 root -> mid -> leaf 三级，root 撤销后 leaf 也 deny。

### 2.5 纯函数确定性
- 投影 / 校验 / merge / pack 等纯函数体内不得调用 `Date.now()` / `new Date()` / `Math.random()`；
  时间一律由调用方注入。确需兜底的（如构造器默认 `createdAt`）必须在 spec 与 DEVLOG 显式记录，
  且不影响投影确定性（同一输入两次投影 deep-equal）。

### 2.6 开发端自验收（关键！）
- 写完代码后，开发 agent 必须**以独立 verifier 的视角**自测一遍，而不是只跑自己写的测试：
  1. 对照 spec 的 L 判定表逐条核对，每条写出「PASS/FAIL + 证据（测试名或探针名）」。
  2. 对最易翻车的反例创建**临时 Vitest 探针**（参考 Stage 3/4 验收探针 A/B/C/D），跑通后
     **立即删除**，最终 `git status --short` 不得有探针残留。
  3. 把每类命令的 exit code 与关键输出、L 表逐条判定、产品锁/密钥复核写入 DEVLOG。
- 自验收通过标准 = L 表全 PASS、全部门禁 exit 0、无探针残留、产品锁 false、key 三作用域 absent。

### 2.7 产品锁 / 密钥 / 卫生硬门禁（每个 stage 结束必查）
- 对新增/修改生产文件 grep `defaultOn|liveReady|productApproved`：必须 0 命中。
- `DEEPSEEK_API_KEY` 在 Process / User / Machine 三处必须 absent。
- 工作树正则精确扫描 `sk-[a-f0-9]{32}`：0 命中。
- 未新增权限数据库 / approval ledger / grant 表 / durable store / 并行 memory writer。
- 未 commit / push / PR；HEAD 不变；无临时探针/证据残留（除受控 `artifacts/` 脱敏证据）。

### 2.8 真实 provider 证据规则
- 需要真实 provider/真人任务时，key 只能由 owner 以**单次命令临时环境变量**注入，不得写入
  文件、DEVLOG、`.env`、注册表或持久环境；命令文本与日志不得含 key。
- 脱敏证据文件只存 digest/ref/id，不存 key、prompt 原文、工具参数、工具输出。

## 3. 每个 stage 的串行执行流程

对 Stage 5、Stage 6 分别执行，Stage 5 全部完成并自验收通过后才进 Stage 6：

1. 读必读材料（§0 前置 + DEVELOPMENT-CONSTRAINTS + 相应 stage0 契约 + DEVLOG + 前一 stage spec/证据）。
2. 只读确认现状源码接线点（不改代码）。
3. 创建/更新 `harness/specs/tasks/context-control-plane-stageN.md`：
   - frontmatter 写全 `intent / touchedAreas / ownerDecisions(或 blockedBy) / expectedUserBehavior /
     requiredProfiles / requiredRules / forbiddenPatterns / requiredTests / acceptance(L 表逐条)`。
   - 每个 deny/reject reason 与每个 L 项都要在 `requiredTests` 有落点。
4. `pnpm harness context --spec ...` + `pnpm harness validate --spec ...` 均 PASS。
5. 写生产代码 + 契约/负向/runtime 测试（覆盖 §2 全部反例）。
6. 执行 §2.6 开发端自验收（含临时探针，跑完即删）。
7. 跑该 stage 全部门禁命令（见各 stage 章节）。
8. 追加 DEVLOG 切片 + 更新 STAGE-ROADMAP。
9. Stage 5：确认 §4 自验收全绿后才进 Stage 6；Stage 6：完成后交付（不 commit/push/PR）。

## 4. Stage 5：Memory 收敛 + unit-aware packing + 真实任务对照

### 4.1 目标
1. 收敛 Memory：单一 durable owner，其余后端为 provider/adapter；每 namespace 一个
   semantic-memory authority。
2. 把字符前缀截断替换为 unit-aware token packer。
3. 用真实任务对照收集探索证据，不直接 default-on。

### 4.2 spec 必须冻结的判定表（L 表；开发 agent 在 spec 落实并自测）
- **L1（parallelMemoryWriters=0）**：生产代码中向 Memory 持久化写入的调用点唯一；检索/摘要
  只产候选。证据：静态扫描（grep 写入点）+ 测试。
- **L2（工具名兼容 + Facade）**：`memory_search / memory_get / memory_query / context_search /
  context_read` 工具名保留，底层统一 Memory Facade；结果标注 backend/source/freshness/evidence。
- **L3（Memory 无决策权）**：Memory 不拥有 DCS 决策权；`context_*` 不被伪装成 memory。
- **L4（unit-aware packer）**：覆盖 token、tool schema、多模态、输出 reserve；critical/constraint/
  evidence 整单元保留，超窗显式失败/降级，**不静默截断**。
- **L5（确定性）**：packer/投影对同一输入稳定输出；无 wall-clock/随机（§2.5）。
- **L6（默认 off）**：flag off 时零行为变化（工具集、发送字节不变）；只有显式开启才激活。
- **L7（真人任务对照章程）**：真实 provider、单 workspace、Windows x64、≥10 个真人 coding 任务、
  基线/试验配对；E4 证据真实，synthetic 不算（§2.8）。
- **L8（卫生）**：产品锁 false、key 三作用域 absent、sk-hex32 0 命中、无 commit/push/PR。

> 具体数值（critical 保留率、P95 延迟/成本阈值）若无法从 DEVELOPMENT-CONSTRAINTS 裁定，
> 写入 spec `blockedBy` 停下等待 owner，**不要自造数值**。

### 4.3 关键反例（自测探针必须覆盖）
- 超窗时 critical 单元被静默截断（必须显式失败/降级并给出可查询原因）。
- 两个并行 memory writer（grep 出两个写入调用点）。
- `context_*` 被当作 memory authority（决策权错位）。
- packer 输出随 Date.now/随机变化（确定性破坏）。
- flag off 时字节/工具集变化（默认行为漂移）。

### 4.4 验收命令（全部 exit 0）
```bash
git rev-parse HEAD && git status --short
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage5.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage5.md
pnpm exec vitest run <stage5 tests> --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts <stage5 runtime tests> --reporter=verbose
pnpm contract:check
pnpm run typecheck
pnpm run lint:check
git diff --check
# 真人任务对照仅在 owner 提供一次性 key 时执行；无 key 时 golden-run runIf 跳过并记录 skipped
```

## 5. Stage 6：Context diff / why-included / policy simulation / replay debugger

### 5.1 目标
把控制平面变成用户可理解、可控制的产品能力：context diff、why-this-was-included、
policy simulation、replay debugger。

### 5.2 spec 必须冻结的判定表（L 表）
- **L1（只读投影）**：基于 PromptPlan / RequestEnvelope / Receipt 的只读投影；UI 不得写
  context authority（不得成为第二上下文/权限权威）。
- **L2（context diff + why）**：显示 selected/omitted/why，每一项可解释来源（来自哪个
  PromptPlan 决策/规则）。
- **L3（policy simulation dry-run 零副作用）**：simulation 为 dry-run，机器检查该路径无任何
  写/effect（无 ledger/receipt/文件副作用）。
- **L4（replay 不重放 effect）**：replay debugger 只重放可恢复输入，不重放工具副作用。
- **L5（脱敏）**：不显示/落盘 raw payload、凭据、秘密；只 digest/ref。
- **L6（UI 接线 + 四语 + E2E）**：用户可见入口走 host-api，不直接 Gateway HTTP；四语 i18n
  （en/zh/ja/ru）；每个可见交互有 Electron E2E 覆盖。
- **L7（确定性/默认）**：投影确定性（§2.5）；默认 off；产品锁 false。
- **L8（卫生）**：key 三作用域 absent、sk-hex32 0 命中、无 commit/push/PR。

### 5.3 关键反例（自测探针必须覆盖）
- simulation 路径落了一条 effect/ledger 行（dry-run 破坏）。
- replay 重放了工具副作用（应只重放输入）。
- UI 直接 fetch Gateway HTTP（应走 host-api）。
- 投影暴露 raw payload / 凭据。
- 四语缺语或硬编码文案。

### 5.4 验收命令（全部 exit 0）
```bash
git rev-parse HEAD && git status --short
pnpm harness context --spec harness/specs/tasks/context-control-plane-stage6.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage6.md
pnpm exec vitest run <stage6 tests> --reporter=verbose
pnpm contract:check
pnpm run typecheck
pnpm run lint:check
pnpm i18n:lint
pnpm run test:e2e <stage6 specs>
git diff --check
```

## 6. 交付物清单（不 commit / 不 push / 不建 PR）

1. `harness/specs/tasks/context-control-plane-stage5.md` 与 `...stage6.md`（含完整 L 表 + requiredTests）。
2. Stage 5 / Stage 6 生产代码 + 契约/负向/runtime 测试。
3. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`：每个 stage 的开发切片 + 自验收记录
   （含每类命令 exit code 与关键输出、L 表逐条 PASS/FAIL、探针记录、产品锁/密钥复核）。
4. `docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md` 当前待办更新。
5. 脱敏证据（仅当 owner 授权真实 provider run 时）写入受控 `artifacts/`。

## 7. 停止条件（不停下继续 = 返工风险）

- 需 owner 裁决的开放项（数值阈值、范围、字段列表）无法从约束裁定时：写 spec `blockedBy` 并停下。
- 需真实 provider / 真人任务证据但无 owner 一次性 key 时：golden-run 用 `runIf` 跳过并记录，
  **停下等待 key**，不伪造、不把 synthetic 当 E4。
- 发现与 DEVELOPMENT-CONSTRAINTS / 蓝图 rev3 / ADR 冲突时：停下记录，升级 owner。
- 任何一条防返工清单（§2）自测不过：先修，不要带着已知缺口进入下一 stage。

## 8. 最终交付话术要求

交付时在回复中给出：
- 两个 spec 的 harness context/validate 结果；
- 两个 stage 的 L 表逐条判定（PASS/FAIL + 证据）；
- 全部命令 exit code 摘要；
- 产品锁与密钥卫生复核结论；
- 明确的「自验收 verdict：accept / accept-with-findings / blocked」。
（最终正式 unlock 仍以独立 verifier 复核为准；本提示词要求开发端先把自验收做到 accept。）
