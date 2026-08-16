# 开发日志：PCS-v1.2 × 会话强度联动修复（规划轮）

> 状态：**PLANNING ONLY / NOT STARTED**
> 日期：2026-08-16
> 工作树：`HEAD 033469f07`（含既有无关 WIP）
> 本日志范围：完整规划本轮修复；本轮不修改任何实现代码，不创建 PCS 实施任务，不修改 Runtime Convergence 或 Task Forest 状态。

---

## 1. 本轮目标

1. 把已定版的 **PCS-v1.2 Prompt Capability Stratification** 与当前 **会话强度（reasoning effort / runtime intensity）** 合并为一条可实施路线。
2. 修复强度审计发现的 F-01 / F-02 / F-03 / F-04 / F-05 / F-10，保留 F-06 / F-07 / F-08 / F-09 的边界约束。
3. 保持用户决策：**强度与提示词工程继续联动**，不拆成两个完全独立的产品控件。
4. 所有提示词贡献最终进入 PCS-v1.2 的 `PromptSourceCatalog` / `PromptAssemblyLedger` / `PromptAssemblyMatrix` 治理，不新增第二套 Context authority。
5. 新增提示词**质量门禁**：最终 prompt 文本本身必须经过预算、去重、缓存稳定性、不可信数据包装和快照测试，而不是只治理来源结构。

---

## 2. 核心设计决策：Linked-v1

产品层仍是一个强度控件；内部拆成两个语义值，但通过固定映射保持联动：

```text
requestedReasoningEffort
        │
        └──► linked map ──► requestedRuntimeIntensity
                                    │
                                    ▼
                        effectiveRuntimeIntensity（不随模型降档漂移）
```

### 2.1 联动映射表 v1

| 用户选择 | requestedReasoning | requestedRuntimeIntensity | effective intensity |
|---|---|---|---|
| `auto` | 模型自行解析 | `baseline` | `baseline` |
| `minimal` | `minimal`（可降档） | `minimal` | `minimal` |
| `low` | `low`（可降档） | `low` | `low` |
| `medium` | `medium`（可降档） | `baseline` | `baseline` |
| `high` | `high`（可降档） | `high` | `high` |
| `xhigh` | `xhigh`（可降档） | `xhigh` | `xhigh` |
| `max` | `max`（可降档） | `xhigh` | `xhigh` |

### 2.2 防漂移不变量

```text
effectiveRuntimeIntensity(requested=high, effectiveThink=medium) == high
effectiveRuntimeIntensity(requested=auto, modelDefault=low)   == baseline
effectiveRuntimeIntensity(requested=xhigh, model降档)          == xhigh
```

模型能力降档只允许改变 `effectiveReasoning`，不允许改变 `effectiveRuntimeIntensity`。

### 2.3 保留现有保护

- `rawModelRun`、显式 `promptMode`、`promptMode=none`、`toolsAllow` 仍优先于 intensity 的 promptMode 部分。
- intensity 永不改变 tools / permissions / approvals / Skills / Task Ledger / `/loop` 权威。
- 旧路径没有新字段时，继续按 `thinkLevel` 推导，保证兼容。

---

## 3. 与 PCS-v1.2 工件的关系

| PCS 工件 | 强度相关职责 |
|---|---|
| `PromptSourceCatalog` | 登记 `runtime.intensity.prompt`、`runtime.intensity.harness_behavior`、L0 能力绑定 |
| `PromptAssemblyLedger` | 记录强度造成的 `promptMode` 参数 mutation、文本贡献、before/after hash、requested/effective 值 |
| `PromptAssemblyMatrix` | 覆盖 effort × model-support × route 矩阵；验证联动不变量 |
| `SessionSystemPromptReport` | 输出 requested/effective reasoning + requested/effective intensity + source + adherence |
| Codex snapshot | 作为 Matrix 的 Codex provider projection，覆盖强度场景 |
| `CodePolicyBinding` | L0 能力边界 `chars=0`，不进入 prompt contribution |

---

## 4. 完整工作包规划

### W0：治理门禁与实施前基线

**触发条件：用户完成 G0 裁决并明确授权后。**

- 确认 Runtime Convergence 当前状态按用户裁决结果更新。
- 确认本轮不抢占 Task Forest 唯一 ready 节点 `TF-0066` 的串行约束；PCS 实施节点需单独获得用户授权。
- 创建/更新 harness task spec：
  - 新增 `harness/specs/tasks/runtime-intensity-linked-coupling.md`
  - 更新 `harness/specs/tasks/runtime-intensity-policy.md` 的预期行为
- 运行只读 baseline：
  ```bash
  pnpm harness context --spec harness/specs/tasks/runtime-intensity-policy.md
  pnpm harness context --spec harness/specs/tasks/remove-work-mode-use-thinking-intensity.md
  ```
- 记录当前强度策略快照作为 legacy 对照。

**退出条件：** G0 已裁决；相关 spec 与 Task Forest 授权状态明确。

---

### W1：Phase 0 小修复（低风险）

目标：修复审计 F-04、F-05 的直接缺陷，不改变架构。

1. 修 `max` 被拒：
   - `electron/services/agents-api.ts:43-50`：`REASONING_EFFORTS` 白名单补 `max`。
   - 新增真实 host API service 测试，不走 store mock：
     - `tests/unit/agents-api-reasoning-effort.test.ts`
   - 保持 runtime 现有 `max -> xhigh` 映射。
2. 修文档与实现不一致：
   - 强度当前是 agent 级持久配置，不是每轮显式偏好；先修 `docs/clawx-design-overview.md` 与 README 三语中的表述。
   - 若 v1 继续采用 agent 级默认值，则明确“每轮使用派生值透传”。
3. UI 文案：
   - `ChatAgentEffortPopover` 的帮助文案从“只让模型想更久”改为“推理档位 + 上下文密度（联动）”。
   - `auto` 文案明确：模型自行决定思考预算；上下文密度保持 baseline。

**验证：**
```bash
pnpm exec vitest run tests/unit/runtime-intensity-policy.test.ts \
  tests/unit/chat-agent-effort-popover.test.tsx \
  tests/unit/agent-config.test.ts \
  tests/unit/agents-api-reasoning-effort.test.ts
pnpm run typecheck
```

**退出条件：** `max` 可经真实 host API 持久化；UI 文案不产生能力授权暗示。

---

### W2：Linked-v1 核心解耦

目标：让强度策略由 requested intensity 决定，而不是降档后的 thinkLevel。

1. 类型：
   - `shared/types/agent.ts`：
     ```ts
     export type RuntimeIntensityPreference =
       'baseline' | 'minimal' | 'low' | 'high' | 'xhigh';
     ```
   - `shared/chat/types.ts` `SendOptions` 预留：
     ```ts
     reasoningEffort?: AgentReasoningEffort;
     runtimeIntensity?: RuntimeIntensityPreference;
     ```
   - `shared/host-api/contract.ts` `ChatSendWithMediaPayload` 增加可选 `runtimeIntensity`。
2. Renderer → Main → Gateway 透传：
   - `src/stores/chat.ts`、`electron/services/chat-api.ts` 透传字段。
   - Main 只做白名单校验和透传，不作为授权来源。
   - Gateway `chat.send` 校验 `runtimeIntensity` 并写入 `FollowupRun.run`。
3. Runtime 解析：
   - `openclaw_runtime/src/agents/intensity-policy.ts` 扩展输入：
     ```ts
     ResolveRuntimeIntensityPolicyInput = {
       requestedRuntimeIntensity?: RuntimeIntensityPreference | null;
       thinkLevel?: ThinkLevel | string | null; // legacy fallback only
       promptModeExplicit?: boolean;
       requestedPromptMode?: PromptMode | null;
       rawModelRun?: boolean;
       source: 'explicit' | 'legacy-thinking-level';
     }
     ```
   - 新增纯函数：
     ```ts
     resolveRequestedRuntimeIntensity({
       reasoningEffort,
       modelDefaultThinkLevel
     }): RuntimeIntensityPreference
     ```
   - `attempt.ts:1112` 改为：
     - 有 `requestedRuntimeIntensity` 时按该值生成策略；
     - 无新字段时保持 legacy `thinkLevel` 推导。
4. 关键接线：
   - `get-reply-run.ts` 在模型降档前计算 requested intensity，并传入 attempt。
   - `model-selection.ts` 继续只负责 reasoning 降档，不参与 intensity。
   - `RunEmbeddedAgentParams` 增加 `runtimeIntensity` / `requestedRuntimeIntensity`。

**验证：**
```bash
pnpm exec vitest run tests/unit/runtime-intensity-policy.test.ts \
  tests/unit/chat-input.test.tsx tests/unit/agent-config.test.ts
pnpm run contract:check
pnpm run typecheck
```

**退出条件：**
- 降档前后 effective intensity 不变；
- `auto` 恒为 baseline；
- legacy 路径行为与 W0 baseline 完全一致。

---

### W3：报告与观测

目标：把“requested / effective / source”变成可验证证据，修复 F-10。

1. `openclaw_runtime/src/config/sessions/types.ts` 扩展 `SessionSystemPromptReport.runtimeIntensity`：
   ```ts
   {
     requestedReasoning: string;
     effectiveReasoning: string;
     requestedIntensity: string;
     effectiveIntensity: string;
     intensitySource: 'explicit' | 'legacy-thinking-level';
     couplingMode: 'linked-v1';
     policyAdherence?: 'full' | 'prompt-only';
   }
   ```
2. `system-prompt-report.ts` 输出上述字段。
3. UI 后续可在 run metadata 中展示 requested / effective reasoning；本轮先保证报告层闭环。
4. 强度模板从 `intensity-policy.ts:124-184` 抽成版本化 profile 数据：
   ```ts
   schemaVersion + policyId + templateHash + tokenEstimate
   ```

**退出条件：** 报告能证明联动防漂移不变量成立，不保存 raw prompt。

---

### W4：harness 边界统一

目标：修复 F-03，让 built-in 与 CLI-backed/插件 harness 不产生隐性差异。

1. `AgentHarnessAttemptParams` 增加可选 `runtimeIntensityPolicy`。
2. `RunCliAgentParams`、`cli-runner/prepare.ts` 增加 `runtimeIntensityPolicy`，CLI 路径至少应用：
   - prompt mode；
   - skills top-k / compact；
   - `Runtime Intensity` system prompt 行；
   - report 元数据。
3. 插件 harness 不支持工具结果/上下文 guard 时：
   ```text
   policyAdherence: "prompt-only"
   ```
   不得静默声称全量生效。
4. `get-reply-options.types.ts` 增加 `runtimeIntensityOverride`，经 `FollowupRun.run` 传到 attempt/CLI。

**验证：**
```bash
pnpm run comms:replay
pnpm run comms:compare
pnpm exec playwright test tests/e2e/effort-intensity-smoke.spec.ts
```

**退出条件：** 同一档位在 built-in / CLI-backed 报告同一 policy；插件路径如实报告 prompt-only。

---

### W5：PCS-v1.2 集成

目标：强度提示词成为正式的、可追踪的 prompt contribution，而不是自由字符串。

1. `PromptSourceCatalog` 登记：
   ```text
   runtime.intensity.prompt
     owner: intensity-policy.ts
     layer: L4 dynamic
     cachePlacement: dynamic
     budget: <= 400 chars
     reducer: none（固定版本化模板，编译/测试期拒绝超预算）

   runtime.intensity.harness_behavior
     kind: runtime-policy
     chars: 0
     enforcementRef:
       attempt.ts
       skills/loading/workspace.ts
       tool-result-truncation.ts
       tool-result-context-guard.ts
   ```
2. `PromptAssemblyLedger` 记录：
   - `promptMode` 参数 mutation；
   - `runtime.intensity.prompt` 文本贡献；
   - skills / toolResults / contextPressure / shellOutput 的行为策略 adherence。
3. `PromptAssemblyMatrix` 增加维度：
   ```text
   effort × model-support × route(R1,R2,R3)
   ```
4. 强度模板保持确定性本地模板；第三方 LLM 只允许作为离线编译/审核器：
   - schema 校验；
   - 禁止返回工具/权限/审批/Skill 启用项；
   - 失败回退本地模板；
   - 默认不发送用户原文。
5. Codex snapshot 在 Matrix 建立后修复，并作为 provider projection。

**验证：**
```bash
pnpm exec vitest run tests/unit/runtime-intensity-policy.test.ts
pnpm run prompt:snapshots:check   # W5 后必须修复并纳入 Matrix
```

**退出条件：**
- 强度贡献在 catalog / ledger / matrix 中唯一归属；
- 自动注入未登记数为 0；
- 最终 prompt hash 变化无 ledger 记录为 0；
- 稳定 cache prefix 不含声明为 dynamic 的强度贡献。

---

### W6：BOOT.md 独立清理

按 PCS-v1.2 的 F-05 定版结论，单独排期：

1. 移除 host API/contract/Electron 文件清单中的 `BOOT.md` 读写：
   - `electron/utils/agent-config.ts`
   - `electron/services/agents-api.ts`
   - `shared/host-api/contract.ts`
2. 不自动删除用户磁盘上的 `BOOT.md`。
3. API 兼容期明确拒绝新写入并返回 deprecation/migration 信息。
4. 用户主动确认后才导出或迁移旧内容。
5. 下一主版本移除 contract 字段。
6. 补 unit + Electron E2E，证明不再产生无效 prompt 文件。

**退出条件：** `BOOT.md` 无效写入路径为 0；磁盘用户文件未被静默删除。

---

### W7：文档、i18n、契约与收口

1. i18n：
   - `shared/i18n/locales/{en,zh,ja,ru}/chat.json` 更新强度语义文案。
2. README：
   - `README.md`、`README.zh-CN.md`、`README.ja-JP.md`。
3. 设计文档：
   - `docs/clawx-design-overview.md`。
4. Harness：
   - 新增/更新 task spec；
   - `pnpm harness validate --spec <spec>`。
5. 收口证据：
   - 测试、报告、diff 清单写入本轮开发日志和 handoffs。

---

### W8：系统提示词质量重构（新增，基于本地实测）

**背景：** 即使 PCS 治理和强度联动全部正确，如果最终 prompt 文本本身质量差，能力仍会受损。当前环境没有可用的 anysearch / web_search 工具，不能实时检索外部范式；W8 先以本地实测和可执行的结构化质量门禁为基线，外部资料检索作为待补输入。

**本地实测基线（2026-08-16，模拟 ClawX 默认 workspace）：**

```text
总字符：29,154
估算 token：约 7,289
cache boundary 前稳定前缀：25,234 chars / 约 6,309 tokens
cache boundary 后动态后缀：3,920 chars / 约 980 tokens
顶级 section 数量：约 48
```

该基线说明：**prompt 组装机制尚可，但最终文本过长、section 过多、信息密度偏低。**

**质量判断：**

1. 当前 prompt 是 OpenClaw runtime 自带组装器的输出，不是单独维护的静态官方 prompt：
   - 核心组装器：`openclaw_runtime/src/agents/system-prompt.ts`
   - 默认模板：`openclaw_runtime/docs/reference/templates/`
   - ClawX 覆盖：`resources/context/*.clawx.md`、`electron/utils/openclaw-workspace.ts`
   - 因此它属于“OpenClaw 官方 runtime 生成器 + ClawX 定制叠加”，不是可直接照抄的外部最佳实践。
2. 结构问题：
   - section 数量过多，主 prompt 同时承载聊天人格、群聊礼仪、心跳、coding、ACP、沙箱、Skills、文档、自更新、授权发送者等语义。
   - `Safety` 与模板 `Red Lines`、`Execution Bias` 与 GPT overlay 行为合同重复。
   - workspace 文件全文注入，且模板里包含大量非策略内容（`Related`、`Make It Yours`、示例等）。
3. 安全问题：
   - 用户可编辑 workspace 文件未统一用不可信数据包装；
   - 优先级的表达分散在多个 section，而不是顶部一个 precedence block。
4. 文本质量：
   - 指令多为长句 prose，而非紧凑、可验证的 bullets；
   - 模板版本化不足，改一个模板会影响所有 workspace；
   - 没有自动化质量门禁（长度、重复率、受保护语义、可读性、缓存前缀稳定性）。

**W8 交付物：**

1. 建立 `PromptQualityBaseline`：
   - 对 full / minimal / heartbeat / subagent / coding 场景记录 chars、tokens、section、重复规则。
   - 目标预算执行 PCS-v1.2 的 L1/L3/L4 上限，并逐步压缩。
2. 建立质量 rubric（不做实时 LLM 热路径）：
   - 结构：每个 contribution 必须有 `semanticKey`、owner、budget、cachePlacement；
   - 单一归属：同一规则不在两个 owner 重复；
   - 缓存：stable prefix 字节稳定，dynamic contribution 不在边界前；
   - 安全：不可信 workspace 内容有显式 wrapper 和优先级；
   - 预算：无 reducer 贡献不得运行时半截裁剪；
   - 回归：快照 hash + 行为测试。
3. 设计 v2 主 prompt 模板，参考已知公开范式的共性：
   - Anthropic/Claude Code 风格：短 system prompt + 按需读取工具/skill，规则稀疏；
   - OpenAI Codex `AGENTS.md` 风格：根入口轻量，scoped 规则按目录加载；
   - agentskills.io / Claude Skills 风格：skill 元数据 + `SKILL.md` 按需读取；
   - provider prompt cache 风格：稳定前缀 + 动态后缀。
   - 以上为仓库内已有实现和通用工程共识，不冒充本轮外部检索结果。
4. 增加离线质量测试：
   - `prompt-quality-budget.test.ts`
   - `prompt-quality-duplication.test.ts`
   - `prompt-quality-invariants.test.ts`
   - 测试只读、确定性、无第三方 LLM 依赖。
5. 待外部检索项：
   - 需要 anysearch / web 工具或用户提供参考后，补充 3-5 个当前最佳 prompt 范式及逐项对比表。
   - 未取得真实来源前，不得把外部 prompt 原文或断言写入 spec。

**退出条件：**
- 主 prompt 默认场景进入目标预算；
- 自动注入贡献全部有语义键和唯一 owner；
- 同一规则重复数为 0；
- 质量测试与快照全绿；
- 外部参考资料有来源、日期和可核验链接后才可引用。

---

## 5. 文件触碰总表


### 类型 / 契约
- `shared/types/agent.ts`
- `shared/chat/types.ts`
- `shared/host-api/contract.ts`
- `openclaw_runtime/src/config/sessions/types.ts`

### Renderer
- `src/stores/chat.ts`
- `src/components/chat/ChatAgentEffortPopover.tsx`
- `src/lib/host-api.ts`
- 必要时 `src/pages/Chat/*`

### Electron Main
- `electron/services/agents-api.ts`
- `electron/services/chat-api.ts`
- `electron/utils/agent-config.ts`

### Runtime
- `openclaw_runtime/src/agents/intensity-policy.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`
- `openclaw_runtime/src/agents/embedded-agent-runner/run/params.ts`
- `openclaw_runtime/src/agents/system-prompt-report.ts`
- `openclaw_runtime/src/auto-reply/reply/get-reply-run.ts`
- `openclaw_runtime/src/auto-reply/get-reply-options.types.ts`
- `openclaw_runtime/src/gateway/server-methods/chat.ts`

### Harness / CLI / PCS
- `openclaw_runtime/src/agents/harness/types.ts`
- `openclaw_runtime/src/agents/command/attempt-execution.ts`
- `openclaw_runtime/src/agents/cli-runner/prepare.ts`
- PCS 新模块：`PromptSourceCatalog`、`PromptAssemblyLedger`、`PromptAssemblyMatrix`
- `openclaw_runtime/scripts/generate-prompt-snapshots.ts`

### 治理 / 文档
- `harness/specs/tasks/runtime-intensity-policy.md`
- 新增 `harness/specs/tasks/runtime-intensity-linked-coupling.md`
- `docs/clawx-design-overview.md`
- `docs/dev/handoffs/LATEST.md`（G0 授权后的会话收口时更新）

---

## 6. 验证矩阵

```bash
# 单元与策略
pnpm exec vitest run \
  tests/unit/runtime-intensity-policy.test.ts \
  tests/unit/chat-agent-effort-popover.test.tsx \
  tests/unit/chat-input.test.tsx \
  tests/unit/agent-config.test.ts \
  tests/unit/agents-api-reasoning-effort.test.ts

# 类型与契约
pnpm run typecheck
pnpm run contract:check

# E2E（UI 行为变化必须有）
pnpm exec playwright test tests/e2e/effort-intensity-smoke.spec.ts \
  tests/e2e/work-mode-intensity.spec.ts

# 通信路径（有变化必须跑）
pnpm run comms:replay
pnpm run comms:compare

# PCS 相关
pnpm harness validate --spec <new-or-updated-spec>
pnpm run prompt:snapshots:check
```

---

## 7. 风险与回滚

| 风险 | 控制 |
|---|---|
| 模型降档仍污染强度策略 | W2 增加不变量单测；报告记录 requested/effective |
| CLI-backed 与插件 harness 假报全量生效 | W4 强制 `policyAdherence`；prompt-only 不得写 full |
| 强度提示词击穿稳定 cache prefix | 强度贡献固定 `cachePlacement=dynamic`；W5 Matrix 校验 |
| 新预算导致不可预测截断 | 强度模板无 reducer；超预算在编译/测试期拒绝；未知/opaque 内容禁止半截裁剪 |
| 能力切换混入强度 | 遵循 `runtime-intensity-policy.md`、`chat-loop-boundary.md`；能力切换另开 `capabilityProfile` |
| PCS 成为新 orchestrator | 只使用轻量 ledger + route finalizer；Context Engine 仅作 adapter；RC-03 不扩权 |
| 治理绕过 | G0 前不创建 PCS 任务、不改 Runtime Convergence 状态；任何状态变更由用户裁决 |

回滚策略：

- W1/W2 改动均带 legacy 路径，回滚即恢复 `legacy-thinking-level` 输入；
- W5 强度贡献先 shadow compare，连续通过后删除 legacy；
- 每个 W 包保留独立验收记录，不进行跨包原子大提交。

---

## 8. 明确不做的范围（本轮）

- 不新增第二个强度控件；保持单控件联动。
- 不让 intensity 改变 tools / permissions / approvals / Skills / Task Ledger / `/loop`。
- 不把第三方 LLM 放进 chat send 热路径。
- 不把 Context Orchestrator / RC-03 seal 升格为全局 Prompt Authority。
- 不自动删除用户磁盘上的 `BOOT.md`。
- 不在 G0 前创建 PCS 实施任务或修改 Runtime Convergence 状态。
- 不修改本日志以外的 Task Forest 文件。

---

## 9. 下一步

1. 用户完成 G0 裁决并明确授权。
2. 创建本轮 task spec，并把本开发日志归档为 `docs/dev/unified-agent-system/` 下的正式实施基线。
3. 执行 W0 → W1。

