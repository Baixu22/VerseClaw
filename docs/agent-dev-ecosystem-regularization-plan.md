# Agent Dev Ecosystem Regularization Plan

本文档给出 Verse Claw 后续面向 Agent 工具开发、扩展规整化、验收自动化的最终方案草案。它基于当前仓库已经存在的设计与实现，包括 `harness/specs/**`、`hostApi.agentDev`、Agent Dev Control Plane、E2E helpers、i18n 目录、comms replay/compare、Playwright 质量测试与现有插件/技能/channel/runtime 边界。

目标不是建立一套新的规则系统，而是把已有的规范、脚手架、场景、contract、测试与诊断能力收拢成一个可编程、可验证、可扩展的 Agent Dev Control Plane。

## 1. 总目标

让外部 agent 或开发者新增功能时，不再依赖记忆大量规则，而是通过工具链自动获得：

- 标准目录与代码脚手架
- Host API / Gateway / Runtime contract 约束
- i18n 四语种检查
- E2E 场景入口与可组合 scenario
- a11y / visual / selector 质量报告
- channel / skill / plugin conformance tests
- trace、diagnostics、cost、transport replay 等验收证据

最终形态是：

```text
新增功能 -> scaffold -> contract -> scenario -> harness spec -> tests -> workbench -> CI gate
```

所有长期规则仍然进入 `harness/specs/**`，所有开发态能力通过 `hostApi.agentDev` 和现有 Main-owned transport 边界暴露。

## 2. 当前基础判断

当前生态已经具备继续扩展的基础：

- `harness/specs/**` 已经是 durable coding policy 的入口，包含 rules、scenarios、tasks、guides、layers。
- `harness/specs/tasks/agent-dev-control-plane.md` 已经定义了 Agent Dev Control Plane 的验收标准。
- `hostApi.agentDev` 已经提供状态种子、scenario、host-api record/replay、feature flags、visual preset、diagnostics snapshot、transport trace、selector contract。
- `src/lib/host-api-client.ts` 已支持 renderer 侧 host-api 调用 record/replay。
- `tests/e2e/fixtures/electron.ts` 已提供 `openAgentDevScenario` 等 E2E 辅助入口。
- `tests/e2e/agent-dev-quality.spec.ts` 已产出基础 a11y 和 visual artifact。
- `scripts/agent-dev-scaffold.mjs` 已提供 `page|e2e|host-route` 脚手架雏形。
- `scripts/agent-dev-workbench.mjs` 和 `scripts/agent-dev-benefit-eval.mjs` 已能生成静态 workbench 和收益报告。
- `shared/i18n/locales/{en,zh,ja,ru}` 已有四语种 namespace 基础。

主要缺口：

- scenario 仍然是多处硬编码枚举，不支持组合、参数化、外部注册。
- runtime schema 校验主要覆盖 `agentDev` 少数 payload，未形成全链路 contract-first。
- 缺少 `contract:check`、`i18n:lint`、`skill:create`、`channel:conformance`、`store:analyze` 等验收命令。
- `agent-dev:make` 还不是 skill/channel/plugin 的完整生成器。
- Workbench 还是静态入口索引，尚未成为统一诊断控制台。

## 3. 设计原则

### 3.1 单一规范源

不新增 `.trellis/`、`rules/`、`specs2/` 之类平行目录。长期规则、场景、任务、层级约束继续进入：

```text
harness/specs/
  rules/
  scenarios/
  tasks/
  guides/
  layers/
```

新增功能如果引入新的开发约束，必须同步更新对应 harness rule/scenario/task。

### 3.2 Main-owned Boundary

Renderer 不直接访问 Gateway HTTP、IPC 或 runtime 进程。所有新增开发工具能力仍走：

```text
Renderer -> src/lib/host-api.ts -> hostApi -> Main service -> Gateway/runtime/filesystem
```

Agent Dev 工具也不得绕过 `src/lib/host-api.ts` / `src/lib/api-client.ts`。

### 3.3 Contract Before UI

凡是跨 Renderer / Main / Gateway / Runtime 的新功能，先定义 contract，再实现 UI。

短期使用现有 TypeScript 类型与 TypeBox schema 作为事实源；中期引入 `contracts/` registry；长期再考虑 YAML/JSON schema codegen。

### 3.4 验收即资产

每个功能的验收不只是一条测试命令，而应该沉淀为：

- harness spec
- scenario seed
- E2E test
- schema check
- i18n check
- diagnostics/trace artifact
- docs update

## 4. 最终架构

```text
docs / harness specs
        |
        v
Agent Dev Registry
  - contracts
  - scenarios
  - scaffolds
  - quality gates
  - conformance suites
        |
        v
hostApi.agentDev
  - scenario management
  - seed state
  - host-api replay
  - diagnostics snapshot
  - transport trace
  - selector contract
  - quality reports
        |
        v
Agent Dev Workbench
  - Scenario Manager
  - Contract Viewer
  - Trace Timeline
  - i18n Report
  - a11y / Visual Report
  - Skill / Channel Conformance
  - Cost / Token Report
```

## 5. P0：立即落地的基础护栏

### 5.1 Contract Check

新增命令：

```bash
pnpm contract:check
```

第一阶段不重写所有 contract，先基于现有文件做一致性检查：

- `shared/host-api/contract.ts`
- `src/lib/host-api.ts`
- `electron/services/**-api.ts`
- `shared/host-api/*schemas.ts`
- `tests/unit/*schema*.test.ts`

检查内容：

- `HostApiContract` 中声明的 module/action 是否在 Main service registry 中存在。
- `src/lib/host-api.ts` 暴露的方法是否都走 `invokeHost`。
- 新增 mutating host-api 是否有 runtime payload schema 或明确豁免。
- `agentDev` scenario id 是否只来自统一 registry。
- contract 变更是否有对应 unit test 或 E2E test。

建议新增：

```text
scripts/contract-check.mjs
tests/unit/contract-check.test.ts
harness/specs/rules/contract-first-boundary.md
```

### 5.2 Scenario Registry 与 Composable Scenario

把当前散落在 `contract.ts`、`agent-dev-api.ts`、`src/lib/agent-dev.ts` 中的 scenario 枚举收敛为：

```text
shared/agent-dev/scenarios.ts
```

统一导出：

```ts
type AgentDevScenarioId = string;

type AgentDevScenarioDefinition = {
  id: string;
  route: string;
  description: string;
  seed: Record<string, unknown>;
  slices?: string[];
  tags?: string[];
};
```

支持组合形式：

```text
?devScenario=chat-streaming+models-heavy-usage
?devScenario=transport-fallback-chain&streamDelay=500&errorAt=3
```

组合规则：

- 同一 state slice 冲突时，后出现或高 priority 的 scenario 覆盖。
- 参数通过 query string 进入 `overrides`。
- `hostApi.agentDev.scenarios()` 返回基础 scenario 与可组合元信息。

P0 新增场景：

- `transport-fallback-chain`
- `skill-execution-timeout`
- `multi-agent-handoff`
- `knowledge-conflict-merge`
- `channel-reconnect-storm`
- `clawgraph-dag-cycle`

### 5.3 i18n Lint

新增命令：

```bash
pnpm i18n:lint
```

第一阶段检查：

- `shared/i18n/locales/en|zh|ja|ru` namespace 文件名一致。
- 同 namespace 下 key path 一致。
- TSX 中新增明显硬编码用户可见字符串时报错或警告。
- `useTranslation(namespace)` 的 namespace 必须存在。
- scaffold 生成页面时自动创建四语种 namespace stub。

建议新增：

```text
scripts/i18n-lint.mjs
tests/unit/i18n-lint.test.ts
harness/specs/rules/i18n-locale-coverage.md
```

### 5.4 P0 CI 接入

新增聚合命令：

```bash
pnpm agent-dev:validate
```

包含：

```bash
pnpm contract:check
pnpm i18n:lint
pnpm harness:ci
pnpm test:e2e:agent-dev-quality
```

对于涉及通信路径的变更，仍额外运行：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

## 6. P1：扩展开发脚手架

### 6.1 统一 Scaffold

扩展当前命令：

```bash
pnpm agent-dev:make <page|e2e|host-route|skill|channel|plugin|scenario> <name>
```

新增 `skill` 输出：

```text
skills/<name>/
  index.ts
  manifest.yaml
  schema.yaml
  __fixtures__/mock-context.json
  __tests__/unit.test.ts
  __tests__/harness.spec.ts
  i18n/en.json
  i18n/zh.json
  i18n/ja.json
  i18n/ru.json
```

新增 `channel` 输出：

```text
openclaw_runtime/extensions/channels/<name>/
  adapter.ts
  manifest.yaml
  schema.yaml
  __fixtures__/
  __tests__/conformance.test.ts
```

新增 `scenario` 输出：

```text
harness/specs/scenarios/<name>.md
tests/e2e/<name>.spec.ts
shared/agent-dev/scenarios/<name>.ts
```

脚手架必须拒绝覆盖已有文件，并且默认生成 i18n、schema、harness spec 和测试 stub。

### 6.2 Skill/Plugin Contract

Skill/Plugin 新增功能必须声明：

- name/version
- capabilities
- input/output schema
- i18n namespace
- required permissions
- conformance fixtures

短期用 YAML + TypeScript loader；长期可统一进入 `contracts/` codegen。

### 6.3 Channel Conformance

新增命令：

```bash
pnpm channel:conformance <channel-name>
```

基础检查：

- send text
- receive text
- markdown/format downgrade
- rate limit
- connection drop
- message too long
- credential missing
- binding behavior
- logs/diagnostics visibility

报告输出：

```text
artifacts/channel-conformance/<channel-name>/report.json
artifacts/channel-conformance/<channel-name>/report.md
```

## 7. P1：Scenario Recorder

新增 `hostApi.agentDev.recordScenario` 与 Workbench 入口，录制内容：

- route
- selected Zustand/app state snapshot
- hostApi call history
- transport trace
- active feature flags
- current language/theme
- visible toast/modal/test-id state
- recent gateway diagnostics

输出到：

```text
artifacts/agent-dev-scenarios/<timestamp>-<slug>.scenario.json
```

安全要求：

- 默认脱敏 API keys、tokens、Authorization headers、用户主目录路径。
- 不自动写入 `harness/specs/**`。
- 需要人工确认后才能 promote 为正式 scenario。

## 8. P2：Workbench 产品化

当前 `agent-dev:workbench` 是静态 scenario index。目标升级为多面板开发控制台：

- Scenario Manager：列出、组合、打开、录制、导出 scenario。
- Contract Viewer：展示 Host API/Gateway contract 覆盖率。
- Trace Timeline：串联 renderer event、hostApi、Main IPC、Gateway、runtime、model call。
- i18n Report：展示 missing/unused/hardcoded key。
- Quality Report：展示 a11y、visual、selector coverage。
- Skill Sandbox：展示 skill capabilities、effect log、budget。
- Channel Emulator：离线模拟 channel event、rate limit、格式降级。
- Cost Simulator：根据 usage/trace 估算 token 和成本。

Workbench 初期仍可生成静态 HTML，后续再接入 app 内开发者页面。

## 9. P2：Trace 与 Cost

Trace 统一使用 `requestId` 串联：

```text
UI action -> hostApi call -> Main handler -> Gateway RPC -> Runtime/model/tool -> response -> UI update
```

新增 event envelope：

```ts
type AgentDevTraceEvent = {
  id: string;
  requestId?: string;
  at: number;
  layer: 'renderer' | 'host-api' | 'ipc' | 'gateway' | 'runtime' | 'model' | 'tool';
  direction: 'in' | 'out' | 'internal';
  label: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};
```

Cost Simulator 不直接调用外部模型，只基于历史 usage/trace 估算：

- total tokens
- input/output/cache tokens
- estimated cost
- by agent
- by skill
- hot path

## 10. P3：Skill Sandbox Runtime

当 skill/plugin 生态规模扩大后，引入 runtime sandbox：

- Capability Gate：network/filesystem/model-call/channel-send 等权限按调用检查。
- Budget Monitor：限制 token、API calls、execution time、memory。
- Effect Log：记录所有外部效果，支持 replay/audit。

P3 的原因是当前风险可控，且实现成本较高。P0/P1 的 contract、scenario、lint、scaffold 会先显著降低开发混乱度。

## 11. 文件与命令规划

建议新增或调整：

```text
shared/agent-dev/scenarios.ts
shared/agent-dev/scenario-composer.ts
shared/agent-dev/trace-contract.ts

scripts/contract-check.mjs
scripts/i18n-lint.mjs
scripts/channel-conformance.mjs

docs/agent-dev-ecosystem-regularization-plan.md

harness/specs/rules/contract-first-boundary.md
harness/specs/rules/i18n-locale-coverage.md
harness/specs/scenarios/agent-dev-composable-scenarios.md
harness/specs/tasks/agent-dev-ecosystem-regularization.md

tests/unit/contract-check.test.ts
tests/unit/i18n-lint.test.ts
tests/unit/agent-dev-scenario-composer.test.ts
tests/e2e/agent-dev-composable-scenarios.spec.ts
```

建议新增 package scripts：

```json
{
  "contract:check": "node scripts/contract-check.mjs",
  "i18n:lint": "node scripts/i18n-lint.mjs",
  "channel:conformance": "node scripts/channel-conformance.mjs",
  "agent-dev:validate": "pnpm contract:check && pnpm i18n:lint && pnpm harness:ci && pnpm test:e2e:agent-dev-quality"
}
```

## 12. 分阶段验收标准

### P0 验收

- `pnpm contract:check` 可运行并能发现 host-api contract/service/facade 不一致。
- `pnpm i18n:lint` 可运行并覆盖四语种 key 一致性。
- scenario registry 成为唯一 scenario 来源。
- `?devScenario=a+b` 可以打开组合 scenario。
- `pnpm agent-dev:validate` 可作为本地质量入口。
- 对应 harness rules/tasks 已更新。

### P1 验收

- `pnpm agent-dev:make skill <name>` 生成完整 skill scaffold。
- `pnpm agent-dev:make channel <name>` 生成 channel adapter scaffold 与 conformance stub。
- `pnpm channel:conformance <name>` 输出 JSON/Markdown 报告。
- Scenario Recorder 生成脱敏 artifact。
- 新增 skill/channel 的 PR 默认包含 schema、i18n、fixture、harness spec、unit/E2E test。

### P2 验收

- Workbench 能展示 scenario、contract、trace、quality、i18n 报告。
- Trace Timeline 能通过 requestId 串联 host-api 到 Gateway/runtime。
- Cost report 能从历史 usage/trace 估算 token 成本。

### P3 验收

- Skill sandbox 支持 capability gate、budget monitor、effect log。
- Effect log 可供 replay/audit 使用。

## 13. 决策建议

推荐后续按如下顺序推进：

1. P0-A：Scenario Registry + Composer
2. P0-B：Contract Check
3. P0-C：i18n Lint
4. P0-D：`agent-dev:validate`
5. P1-A：扩展 `agent-dev:make` 到 skill/channel/scenario
6. P1-B：Channel Conformance
7. P1-C：Scenario Recorder
8. P2：Workbench 产品化与 Trace Timeline
9. P3：Skill Sandbox Runtime

这个顺序能最大化复用当前基础，同时最快降低后续开发难度和验收成本。

## 14. 最终结论

Verse Claw 当前生态已经具备实现“开发规整化 + 验收增强”的基础，关键是不要另起炉灶，而是把现有 `harness/specs/**`、`hostApi.agentDev`、E2E helpers、i18n、comms replay、diagnostics 和脚手架串成一条强约束工具链。

最终方案是：

```text
harness 负责规则与任务语义
contract check 负责跨层接口一致性
scenario registry 负责可复现状态
scaffold 负责标准起步
i18n/a11y/visual/conformance 负责质量验收
workbench 负责可视化诊断
CI gate 负责强制执行
```

当这条链路完成后，新增 feature、skill、channel、plugin 不再是“读规则后手工遵守”，而是“脚手架生成正确结构，contract 拦截接口偏差，scenario 固化可复现状态，harness 与测试给出验收证据”。
