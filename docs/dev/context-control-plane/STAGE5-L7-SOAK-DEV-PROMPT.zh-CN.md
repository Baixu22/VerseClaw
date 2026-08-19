# Stage 5 L7 Post-Stage6 Soak 开发提示词（Deferred Observations 收口）

> 启用条件：Stage 6 修复后复验 verdict=`accept` 且 owner 已提供全部 soak 数值输入。
> 本提示词是 Stage 5 L7（owner D6/D7）延后项的收口入口；执行 agent 不得把 synthetic/cached run 晋升为 E4。

## 0. 前置事实

- 分支：`codex/context-control-plane-stage0`
- 基线 HEAD：`f55201b22630d5c904f3105b2a9c8876ea5e889b`
- 工作树：`D:\verse_claw_worktree`
- Stage 0–4 已 `accept`；Stage 5 开发端 L1–L8 PASS，其中 L7 按 owner D6/D7 使用 agent-operated real-provider evidence，数值阈值延后到 Stage 6 后 soak/探索。
- Stage 6 修复后复验必须已 `accept`，否则不得启动本切片。
- 本切片只做观测、证据与指标投影；不得翻任何产品默认，不得新增 authority/store/writer。

## 1. owner 必须先行提供（缺一项即停止）

以下输入必须在新建 harness spec 前由 owner 书面提供，禁止执行 agent 自造数值：

| 编号 | 必填输入 | 说明 |
|---|---|---|
| S1 | critical 保留率目标 | 定义分子/分母与样本口径（单次 coding turn 内 critical units selected / 应保留） |
| S2 | constraint 保留率目标 | 同上 |
| S3 | evidence 保留率目标 | 同上 |
| S4 | P95 编译延迟目标 | 单位 ms，统计口径（冷/热、node 版本、Windows x64） |
| S5 | P95 或单轮成本目标 | 币种、口径（token 成本 / 总轮成本 / 每 effective coding turn） |
| S6 | 最小真实样本数与配对协议 | 至少多少有效 coding turn；baseline/试验如何配对、乱序与排除规则 |

处理规则：

- 若任一输入缺失：只允许创建/更新 harness spec 并把缺失项写入 `blockedBy`，运行
  `pnpm harness context/validate` 后**停止**，不写生产代码。
- owner 补齐后，将 `blockedBy` 转成 `ownerDecisions`，再开始实现。

> key 注入**不属于新增 owner 输入**：真实 provider key 仍遵守原定
> `STAGE5-6-SERIAL-DEV-PROMPT.zh-CN.md` §2.8 / §7——仅 owner 单次命令临时环境变量注入，
> 不得写入文件、DEVLOG、`.env`、注册表或持久环境；命令文本与日志不得含 key。

## 2. 必读材料

1. `AGENTS.md`
2. `docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md`
3. `docs/dev/context-control-plane/STAGE5-6-SERIAL-DEV-PROMPT.zh-CN.md`
4. `harness/specs/tasks/context-control-plane-stage5.md`（重点 D6/D7 与 L7）
5. `harness/specs/tasks/context-control-plane-stage6.md`（Stage 6 只读投影契约）
6. `docs/dev/context-control-plane/DEVLOG.zh-CN.md`
7. `docs/dev/context-control-plane/STAGE-ROADMAP.zh-CN.md`
8. Stage 0 `golden-path-contract.md` / `artifacts-schema.md`
9. `openclaw_runtime/src/agents/stage5-golden-run.ts` / `stage5-golden-run.test.ts`
10. `openclaw_runtime/src/context-engine/stage5-memory-facade.ts` / `stage5-unit-aware-packer.ts`
11. 受控证据样例：`artifacts/context-control-plane/stage5-real-run-evidence.json`

## 3. 目标与允许实现

### 3.1 目标

把 Stage 5 L7 从 “deferred observation” 收口为可判定证据：

- 用 owner 给定的 S1–S6 阈值/样本协议，跑真实 DeepSeek coding turn；
- 计算 critical/constraint/evidence 保留率、P95 编译延迟、成本指标；
- 产出 digest/ref-only 的 soak evidence；
- 回写 `context-control-plane-stage5.md` 的 L7 状态与 ownerDecisions。

### 3.2 允许实现

- 新建 `harness/specs/tasks/context-control-plane-stage5-l7-soak.md`。
- 新建默认 off 的 soak runner（可复用 `stage5-golden-run.ts` 的真实 provider + write + grant/Tool Guard/EffectReceipt 链）：
  - 无 key 时 `runIf(Boolean(process.env.DEEPSEEK_API_KEY))` skip，fail-closed `api-key-missing`；
  - workspace escape 在联网前拒绝；
  - 每次 run 只写 digest/ref/id/指标，不写 key、prompt 原文、工具参数、工具输出。
- 新建纯函数指标投影（保留率 / P95 / 成本聚合）：
  - 时间与随机值由调用方注入；
  - 同输入 deep-equal；
  - 无效样本、重复 runId、负成本、非有限 latency fail-closed 并给查询原因。
- 证据写入受控 `artifacts/context-control-plane/stage5-l7-soak-evidence.json`：
  - 含 schema/model/runId/digest/ref/逐 run 判定/汇总指标；
  - 不含 key、prompt、工具参数、工具输出、凭据。

## 4. 禁止事项

- 自造 S1–S6 阈值或把缺失输入写成默认值。
- 把 synthetic、cached、fixture、agent-surrogate run 晋升为 E4。
- 改变 Stage 5 facade/packer/tool set 的生产行为、默认值或产品锁。
- 新增第二 memory writer、第二 DCS、第二权限库、receipt store、provider 或 durable store。
- 在 soak runner 之外持久化 raw prompt / 工具输出 / 凭据。
- 翻 `defaultOn=false` / `liveReady=false` / `productApproved=false`。
- commit / push / 建 PR。

## 5. 建议 L 表（写入 spec 时按 owner S1–S6 冻结）

| L | 判定标准 |
|---|---|
| L1 | owner S1–S6 已全部写入 spec `ownerDecisions`，缺失项只能留在 `blockedBy` 并停止 |
| L2 | 每个纳入统计的样本都是真实 provider + 真实 coding turn + 真实 effect receipt；synthetic/cached 计数为 0 |
| L3 | critical/constraint/evidence 保留率达到 owner 阈值；分母/分子口径与 S1–S3 一致 |
| L4 | P95 编译延迟与成本达到 owner 阈值；无效/重复/负值样本 fail-closed |
| L5 | soak evidence 只含 digest/ref/id/指标；无 key、prompt、参数、输出 |
| L6 | soak runner 默认 off；无 key skip 且不伪造；开启不影响既有生产字节/工具集 |
| L7 | 指标投影纯函数：同输入 deep-equal；无 wall-clock/random |
| L8 | 全门禁 exit 0；产品锁 false；key 三作用域 absent；`sk-hex32` 0 命中；无 commit/push/PR |

## 6. 验证命令（全部原样执行）

```bash
git branch --show-current
git rev-parse HEAD
git status --short

pnpm harness context --spec harness/specs/tasks/context-control-plane-stage5-l7-soak.md
pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage5-l7-soak.md

pnpm exec vitest run tests/unit/context-control-plane-stage5-contracts.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run src/context-engine/stage5-memory-facade.test.ts src/context-engine/stage5-unit-aware-packer.test.ts --reporter=verbose
pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.agents.config.ts src/agents/stage5-golden-run.test.ts src/agents/stage5-l7-soak.test.ts --reporter=verbose

pnpm contract:check
pnpm run typecheck
pnpm run lint:check
git diff --check
```

- 无 owner 一次性 key 时，真实 run 用例应显示 `skipped`，并记录；不得改 `runIf` 为恒真。
- 若本切片意外触碰 UI/i18n，追加 `pnpm i18n:lint` 与对应 Electron E2E，并写进 spec `touchedAreas`。
- 真实 provider run 结束后立即复核 Process/User/Machine 三作用域 `DEEPSEEK_API_KEY` absent。

## 7. 完成定义

- 新 harness spec context/validate 通过；S1–S6 全部为 owner 提供值。
- 全部 soak 样本满足 L2 真实性；L3–L4 数值达标。
- `stage5-l7-soak-evidence.json` 为 digest/ref-only；L5–L7 测试通过。
- `context-control-plane-stage5.md` 的 L7 从 deferred 更新为 PASS，并记录样本数/阈值/证据路径。
- DEVLOG 追加 soak 切片（命令 exit、L 表逐项、探针删除确认、key/产品锁复核）；ROADMAP 更新。
- 无 commit / push / PR；HEAD 不变。
