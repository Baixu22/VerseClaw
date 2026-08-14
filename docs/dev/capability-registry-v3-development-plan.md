# Capability Registry V3 开发规划

> 状态：V3-00～V3-05 已实现并完成当前门槛；V3-06～V3-08 实现已落地，正在完成累计工程门禁（默认关闭，未宣称 GA）
>
> 工作树：`C:\Users\27933\Desktop\clawx\ClawX-v3-capability-registry`
>
> 分支：`codex/v3-capability-registry`

## 1. 目标

V3 要解决的不是“再造一个工具系统”，而是在既有 OpenClaw Runtime、DCS、MCP、Skill loader、Tool Search 与 ArchiveHandle 之上，建立统一且可渐进披露的能力目录。

目标结构：

```text
Category -> Workflow Namespace -> Capability -> Load -> Execute -> Result Pointer
```

它让模型先看到低成本、可检索的能力导航，再按需加载 Skill 正文或 Tool schema；真正执行仍只由可信 Runtime 完成。

## 2. STaR 摘要

### Situation

- Skill、Tool、上下文资料会随产品演进而增长；一次性投递全部内容会增加 token、TTFT、噪声和 Prompt Cache 失效成本。
- Skill 的正文可以作为消息增量按需加载；Tool 的完整 schema 却需要在原生 tool calling 前可用，两者不能用同一种粗暴的“截断目录”处理。
- 当前 DCS `tool_registry` 是默认关闭、有限预算的摘要 Block；Tool Search 是已有的执行代理；MCP 是外部工具协议；它们都不应被悄悄升级为新的执行权威。

### Task

建立统一的发现、加载、权限、预算和观测模型，同时保留三类能力的语义边界：

| 类型 | 负责的问题 |
|---|---|
| Skill | 如何做 |
| Tool | 能做什么 |
| Context | 当前知道什么 |

### Action

- 用 `CapabilityDescriptor` 统一元数据与生命周期投影，而不统一执行语义。
- 用 `category -> workflow namespace -> candidate` 替代 Skill 目录的线性截断。
- 用 Runtime 冷启动注册、lease、revision/hash 校验保护 Tool 的实际执行。
- 用 Tool Search、Code Mode、Provider-native deferred loading 作为不同执行拓扑；所有拓扑都回到同一权限和执行校验。
- 用现有 checksum-backed `ArchiveHandle` 表达大结果指针，避免把原始 Tool 输出持续塞进模型上下文。

### Result

在能力规模增长时，模型仍可发现正确能力、按需加载完整契约、保持原生工具调用的可靠性，并减少无关上下文、缓存失效和长会话中的 schema 累积。

## 3. 设计边界

### 3.1 权威归属

| 领域 | V3 的处理 |
|---|---|
| Tool 实际执行 | OpenClaw Runtime 是唯一可信执行器 |
| 外部工具协议 | MCP SDK 仍是协议权威 |
| 上下文与目录投影 | DCS / Context Engine 负责 |
| 持久化上下文与授权 | 复用 BlockStore 与已有 owner store |
| Skill 正文加载 | 复用现有 Skill loader |
| 大结果恢复 | 复用 `ArchiveHandle`，不新增对象存储 |
| Renderer 可见能力列表 | 保持为 owner-managed publication 的只读投影 |

### 3.2 明确非目标

- 不新建第二个 Runtime、Tool protocol、能力数据库、daemon、端口或 LLM router。
- 不让模型、Skill 文本、DCS Block 或 Renderer 输入注册 executor。
- 不把现有 DCS Stage 3 `tool_registry` 直接改造成 V3 的执行注册表。
- 不把现有 diagnostics-only registry 升级为执行权威。
- 不在首包改变 Prompt、Tool 调用、审批、重试、MCP materialization、Host API 或 UI。
- 不默认开启、不宣称 GA，也不改变现有 `live_ready`、`product_approved`、`default_on` 锁。

## 4. 核心模型

### 4.1 CapabilityDescriptor

V3 的统一点是“可发现能力的身份与元数据”，不是把 Skill、Tool、Context 混为一种执行对象。

```ts
type CapabilityKind = "skill" | "tool" | "context";
type Stickiness = "step" | "task" | "session";
type ExecutionTopology = "direct" | "proxy" | "code" | "native";

interface CapabilityDescriptor {
  capabilityId: string;
  kind: CapabilityKind;
  category: string;
  workflowNamespace: string;
  title: string;
  description: string;
  triggerKeywords: string[];

  revision: string;
  manifestHash: string;
  schemaHash?: string;
  source: { owner: string; type: string; provenance: string };

  dependsOn?: string[]; // Skill -> Tool / Context；不表示反向执行依赖
  permissions?: string[];
  stickiness: Stickiness;
  executionTopologies?: ExecutionTopology[];
}
```

约束：

- `executorRef` 不属于模型、DCS 或 UI 可见的 descriptor。
- Tool 可被 Skill 依赖；Tool 不依赖 Skill 来获得执行权限。
- `dependsOn` 只表达工作流依赖，不授予权限。
- descriptor 内不存原始 Tool 输出、凭据、闭包、函数对象或大 schema payload。

### 4.2 Trusted Catalog 与 Capability Lease

真实 Tool 执行需要 Runtime 内部的可信绑定：

1. Runtime 仅在冷启动或受控 reload 时注册 executor。
2. catalog 为每次可信重建生成 `catalogEpoch`，策略变化生成 `policyEpoch`。
3. 模型只能获得 session-bound、不可猜测的 `issuedId` lease。
4. 调用前校验 capability id、session、revision、manifest hash、schema hash、policy epoch、executor registration id 与权限。
5. 任一校验失败即 fail-closed，返回受控 fallback 或错误；禁止静默使用旧 executor 或旧 revision。

这条链使“模型发现了什么”与“Runtime 允许执行什么”分离。

### 4.3 分级渐进披露

| 层级 | 模型看到的内容 | 用途 |
|---|---|---|
| L0 | category 名称与 trigger keywords | 判断是否需要检索哪个能力域 |
| L1 | workflow namespace 与紧凑候选摘要 | 在工作流内缩小候选集 |
| L2 | 具体 capability 的描述、权限摘要、依赖关系 | 判断是否加载 |
| L3 | Skill 正文、Tool 完整 schema、Context selector | 执行前按需展开 |
| L4 | 执行结果摘要与 Result Pointer | 继续推理或按需读取大结果 |

Skill 目录的 L0 不再按字母顺序丢弃 description。它按 category / workflow namespace 结构化折叠；每个 bucket 至少保留可检索名称和触发词。

L0 使用双重预算：

- 上下文窗口固定比例上限；
- 条目数量上限。

精确数值通过真实任务集校准，不以当前 `18,000` 字符和 `150` 条目作为长期默认值。工具 namespace 按工作流划分，理想不超过 10 个 Tool；超过 12 个必须拆分或记录豁免理由。

### 4.4 Context、缓存与驱逐

- 新加载的能力信息追加到上下文末尾，不回写或重排稳定 tools 前缀。
- `catalogEpoch` 变化必须可观测，并计入 cache miss 成本。
- `stickiness=step` 在当前步骤结束后可驱逐；`task` 在任务结束或显式切换后可驱逐；`session` 仅在会话边界、策略变更或预算回收时驱逐。
- 小且稳定的能力集合不强制检索。若完整投递低于校准阈值，保持 direct projection，以避免“为了检索而检索”。

### 4.5 Result Pointer

大 Tool 输出不直接长期进入模型上下文。V3 使用现有 `ArchiveHandle` 作为底层恢复凭据，提供：

- 结果摘要；
- session / task 范围内的 pointer；
- `slice`、`search`、`read` 等受预算约束的读取方式；
- checksum、来源、TTL、权限和删除清理。

pointer 元数据可以进入工作记忆；原始结果继续留在既有 archive owner 中。

## 5. 执行拓扑

### 5.1 Direct projection

用于工具集较小且稳定的场景。完整 schema 直接投递，保持现有原生 tool calling 行为。

### 5.2 Proxy fallback

复用现有 `tool_search -> tool_describe -> tool_call` 语义。V3 resolver 提供 `categories -> discover -> describe -> load -> execute -> reflect`，但不替换已有 Runtime executor。

### 5.3 Code Mode

复用既有 Code Mode 的 `tools.search / describe / call`，适合多工具串联且中间结果很大的数据型流水线。每次 bridge 调用仍通过 lease、schema、审批与 Result Pointer 约束；中间结果不应无必要穿越模型上下文。

### 5.4 Provider-native deferred loading

仅在 Provider capability probe 明确支持时启用。它必须包含：

- request / event serializer 与 parser；
- 超时、5xx backoff、circuit breaker；
- 幂等关联，避免 fallback 后重复副作用；
- 失败时自动降级到 proxy，而不是文本协议。

这是一条后置、可选的适配路径，不能阻塞基础 catalog、resolver 或安全链。

## 6. V3 串行开发工作包

一次只进入一个工作包；每包都有独立 Harness spec、feature flag、rollback 与验收证据。

| 包 | 内容 | 依赖 | 默认行为 |
|---|---|---|---|
| V3-00 | 契约、术语、任务集与测量基线 | 无 | 无运行时改变 |
| V3-01 | `CapabilityDescriptor` 与 metadata-only shadow catalog | V3-00 | 现有路径不变 |
| V3-02 | Skill 分级目录与 L0 双预算 resolver | V3-01 | shadow / flag-off |
| V3-03 | Trusted catalog、executor registration 与 lease | V3-01 | 不接管执行 |
| V3-04 | Unified resolver 与 Tool Search fallback 集成 | V3-02、V3-03 | opt-in |
| V3-05 | DCS descriptor projection 与 Result Pointer | V3-03、V3-04 | 保留旧 `tool_registry` |
| V3-06 | Code Mode 接入 | V3-04、V3-05 | opt-in |
| V3-07 | Provider-native deferred adapter | V3-03、V3-04 | provider allowlist |
| V3-08 | 评测、灰度、观测与可选 UI | V3-02 至 V3-07 | shadow -> canary |

### V3-00：契约与基线

交付：V3 专属 Harness task / rule / scenario、fixture corpus、直接投递的 token 与 Recall 基线、flag 和 rollback 矩阵。

禁止：修改 Runtime、Prompt、Tool 调用、DCS Block、存储、Host API、UI。

### V3-01：Capability Descriptor 与影子目录

交付：纯类型、canonical serialization/hash、确定性 category / namespace 分类、Skill / Tool / Context 的单向 adapter、冲突诊断与 catalog snapshot。

首个生产实现只做这一包。建议初始新增面：

```text
openclaw_runtime/src/capabilities/v3/capability-descriptor.ts
openclaw_runtime/src/capabilities/v3/shadow-catalog.ts
openclaw_runtime/src/capabilities/v3/*.test.ts
harness/specs/tasks/capability-registry-v3-foundation.md
harness/specs/rules/capability-registry-v3-boundary.md
harness/specs/scenarios/capability-registry-v3.md
```

禁止触及：`tool-search.ts`、`code-mode*.ts`、`tool-registry-handler.ts`、`context-read-tool.ts`、MCP materializer、Host API、Electron Renderer。

### V3-02：Skill 分级目录

交付：`category -> workflow namespace -> candidate` resolver、结构化折叠、双 cap、small-catalog direct-projection bypass 与检索质量基线。

禁止：靠删除所有 description 或前缀截断来降预算；改变已加载 Skill 的正文含义。

### V3-03：可信 catalog 与 lease

交付：冷启动 / reload executor 注册、`catalogEpoch` / `policyEpoch`、opaque `issuedId`、调用前 fail-closed verifier。

禁止：从模型文本、Skill、DCS 或 Renderer 读取 executor；policy / schema / revision 不匹配时使用旧版本。

### V3-04：统一 resolver 与 fallback

交付：`categories`、`discover`、`describe`、`load`、`execute`、`reflect` 语义；与现有 Tool Search 的兼容投影；flag-off parity。

禁止：替换 Tool Search 的真实 executor 或绕过已有审批 / schema 校验。

当前状态（2026-08-14）：已完成并记录于
`docs/dev/capability-registry-v3-unified-resolver-acceptance.md`。实现保持显式
`enabled=true` opt-in；Tool Search 继续拥有搜索、schema、审批、hooks 与实际执行。

### V3-05：DCS 投影与 Result Pointer

交付：descriptor 到 DCS 的目录投影、namespace / capability 定向读取、ArchiveHandle-backed pointer、受预算的 `slice/search/read`。

禁止：将 DCS 作为 executor owner；创建第二 archive store；把原始大输出塞进 registry 或持久 prompt。

当前状态（2026-08-14）：已完成并记录于
`docs/dev/capability-registry-v3-dcs-result-pointer-acceptance.md`。DCS 侧仅有
caller-owned metadata projection；既有 `tool_registry`、`context_read`、BlockStore
与 Assembler 路径未改动。

### V3-06：Code Mode

交付：Code Mode bridge 通过 V3 resolver 与 lease 执行，保持 sandbox、timeout、abort、approval 与结果指针语义。

当前状态（2026-08-14）：已实现显式 `enabled=true` 的
`CapabilityCodeModeAdapter`。它复用唯一的 Tool Search Code Mode sandbox，搜索/描述经
V3 resolver，调用经 trusted lease、既有 Tool Search executor 与 ArchiveHandle-backed
Result Pointer；bridge request id 在一次运行内幂等。Legacy Code Mode caller 未改变。

### V3-07：Provider-native adapter

交付：native deferred loading probe、请求映射、事件解析、backoff、circuit breaker、proxy fallback 与重复副作用保护。

当前状态（2026-08-14）：已实现 caller-injected、精确
provider/model/workflow allowlist 的 deferred adapter，包含 request/event serializer、
probe、5xx retry/backoff、async circuit breaker、request/event 幂等、abort/timeout 与
副作用后 fail-closed。Provider transport 仍由 owner 注入，未新增 fetch/WebSocket/IPC。

### V3-08：评测与受控灰度

交付：任务集 A/B、OTel / receipt 指标、provider-model-workflow allowlist、可选设置页与 Electron E2E（仅在对用户可见时）。

推广顺序：shadow inventory -> opt-in resolver -> 小范围 canary -> 复核指标。没有真实证据时不默认开启。

当前状态（2026-08-14）：已实现默认关闭的 caller-owned rollout controller 与 bounded
in-memory receipt/evaluation surface。支持 `off`、`shadow`、`opt-in`、`canary`、kill
switch、精确 allowlist、确定性 cohort、低基数 metric sink、Recall@k/首调用/重试/降级/
拒绝/cache epoch/pointer token/topology 报告。报告只把 `live` receipt 作为 rollout
裁决输入；`defaultOn`、`liveReady`、`productApproved` 始终为 `false`，未添加 UI、持久化或
默认 caller。

## 7. 验收策略

### 7.1 契约与安全

- descriptor canonical hash 在相同输入下稳定；重复 id、无效 namespace、owner 冲突必须被诊断。
- descriptor 序列化不能含 executor、函数、闭包、凭据、原始大输出。
- forged、跨 session、过期、revoke、revision/schema/policy mismatch 的 lease 均 fail-closed。
- Skill 无法通过 `dependsOn` 获得 Tool 权限；MCP 仍需真实握手和既有 policy。

### 7.2 行为与回归

- flag-off 下 Prompt、Tool 集合、调用、审批、错误、重试、transcript、存储和 UI 与 legacy 行为保持一致。
- small catalog 维持 direct projection；检索功能不得降低其首调用成功率。
- proxy、Code Mode、native adapter 都必须经同一 schema / policy / approval 校验。
- Pointer 的跨 session、过期、checksum 失配和硬删除清理均被拒绝或正确处理。

### 7.3 质量与成本

每个受控任务集记录：

- category / namespace / capability 三层 Recall@k；
- first-call success、schema retry、fallback rate、policy denial；
- 输入 token、缓存 token、TTFT、catalogEpoch 引起的 cache miss；
- Result Pointer 避免进入模型的 token 数；
- 原生、proxy、Code Mode 三条拓扑的成功率与延迟。

进入下一阶段的最低原则：相对完整投递基线，检索 Recall 不能出现超过 5 个百分点的无解释下降；小工具集是否启用 retrieval 由 V3-00 的真实任务数据决定。

### 7.4 每包工程门槛

每个工作包至少包括：

```text
pnpm harness context --spec <active-v3-spec>
pnpm harness validate --spec <active-v3-spec>
聚焦 Vitest
pnpm run lint:check
pnpm run typecheck
git diff --check
```

触及通信、Provider transport、MCP 或可见 UI 时，再按 active spec 增加 `comms:replay`、`comms:compare`、`contract:check`、i18n、build 与 Electron E2E。

## 8. 回滚策略

| 场景 | 回滚方式 |
|---|---|
| Shadow catalog 异常 | 丢弃 shadow evidence，不影响 legacy path |
| Resolver / Skill routing 异常 | 关闭 V3 flag，回到既有 Skill loader 与完整 / 旧目录路径 |
| Lease 验证失败 | fail-closed；必要时使用既有受控 Tool Search fallback，不复用旧 lease |
| DCS 投影异常 | 停止 V3 projection，保留 Stage 3 `tool_registry` 原行为 |
| Pointer 异常 | 保留摘要与明确失败，不注入未验证原文 |
| Native provider 异常 | circuit breaker 后降级 proxy；禁止重放已开始的副作用 |

## 9. 当前验收顺序

V3-00～V3-05 的基础、目录、lease、resolver、DCS projection 与 Result Pointer 证据已归档。
当前只收口 V3-06、V3-07、V3-08：先通过各自 Harness context/validate 与聚焦测试，再运行
runtime `tsgo`、root lint/typecheck、通信回归（V3-07）和最终累计审计。所有包都保持 opt-in 或
shadow/canary，任何静态或 fixture 报告都不能解除产品锁或宣称 GA。

## 10. 最终累计验收记录（2026-08-14）

V3-06、V3-07、V3-08 的最终实现与累计工程门禁已完成。当前工作区仍保持
`codex/v3-capability-registry` 分支，未提交、未推送，也未解除产品锁。

| 门禁 | 结果 | 证据摘要 |
|---|---|---|
| 三个 active V3 Harness context | PASS | Code Mode、Provider-native、Controlled Rollout 的上下文读取均成功。 |
| 累计 V3 focused Vitest | PASS | 14 个文件、97 个测试：11 个 capability 文件 84 测试、2 个 agents 文件 11 测试、1 个 infra 文件 2 测试。 |
| runtime `tsgo:core` / `tsgo:core:test` | PASS | 生产源码与测试源码类型检查均退出 0。 |
| root `pnpm run lint:check` | PASS | ESLint 0 errors、127 个既有 warnings；DCS oxlint 通过。 |
| root `pnpm run typecheck` | PASS | node/web 项目退出 0；tests 项目的 1269 个既有错误保持 observation-only。 |
| `pnpm run comms:replay` / `pnpm run comms:compare` | PASS | 通信回放与所有阈值比较通过，compare report 为 `PASS`。 |
| `git diff --check` | PASS | 无空白错误。 |
| Strict Harness diff | RESIDUAL | 仅以下三个既有 Task Forest 文件超出 V3 ownedPaths：`.agent-workbench/task-forest/exports/task-forest.graph.json`、`.agent-workbench/task-forest/exports/task-forest.html`、`.agent-workbench/task-forest/graph/forest.json`；本轮未修改、未回退，V3 路径无失败。 |

### 终态锁与发布边界

- `default_on`、`live_ready`、`product_approved` 以及 V3-08 报告中的
  `defaultOn`、`liveReady`、`productApproved` 均保持 `false`。
- V3-06 仍为显式 opt-in；V3-07 仍要求精确 provider/model/workflow allowlist
  与 provider probe；V3-08 仍为 shadow/opt-in/canary 的 caller-owned 控制面。
- 未新增 UI、Host API、持久化、Provider transport、默认 caller 或自动 GA
  路径；既有 Task Forest canonical graph 不在本轮擅自修改范围内。
