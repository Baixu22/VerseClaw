# 提示词质量修复批次 R1（Prompt Quality Round 1）

> 状态：**AUTHORIZED / IN PROGRESS**
> 日期：2026-08-16
> 授权来源：用户现场裁决“先修提示词质量与已知 bug”
> 基线：工作树 dirty（既有无关 WIP），本轮只触碰本文件列出的路径
> 治理：不创建 PCS 实施任务，不修改 Runtime Convergence / Task Forest 状态，不触碰 TF-0066

---

## 1. 目标

在进入 PCS-v1.2 Linked-v1 大型改造之前，先修复已确认的、直接影响最终提示词质量与档位真实性的 bug。原则：

1. **bug 优先**：先修会让用户选择失效或让 provider 收到错误档位的问题。
2. **小步可回滚**：每项修改都有对应测试，不搭新架构。
3. **不扩大范围**：不实现 Linked-v1 解耦、不新建 PCS 三工件、不迁移 BOOT.md、不重写提示词模板。

## 2. 本批修复项

| ID | 问题 | 修复 | 涉及文件 |
|---|---|---|---|
| R1-01 | `max` 在 UI/类型中存在，但 Main 白名单拒绝，持久化失败 | 白名单补 `max`，补真实 host API 单测 | `electron/services/agents-api.ts` |
| R1-02 | DeepSeek V4 实际 payload 映射错误：`low→high`、`xhigh→max`，与官方 `low/high/max`（`medium/xhigh→high`）不符 | 按官方映射修正 shared wrapper，`minimal→low` 保底 | `openclaw_runtime/src/plugin-sdk/provider-stream-shared.ts`、`extensions/deepseek/thinking.ts` |
| R1-03 | 旧 `clawx:begin/end` 品牌块与 `verse-claw` 块并存，AGENTS.md/TOOLS.md 出现逐字重复 | merge 时自动剥离旧品牌块；清理当前默认 workspace | `electron/utils/openclaw-workspace.ts` + 用户 workspace |
| R1-04 | 用户可编辑 workspace 文件 raw 注入，没有统一优先级声明；intensity/DCS 等增量被标成 `Group Chat Context` | 增加不可信上下文优先级声明；普通 Chat 标题改为 `Run Context` | `openclaw_runtime/src/agents/system-prompt.ts` |
| R1-05 | 四语 effort 帮助文案只讲“想更久”，未说明上下文密度联动 | 更新四语文案，明确推理档位 + 上下文密度 | `shared/i18n/locales/{en,zh,ja,ru}/chat.json` |
| R1-06 | 设计文档称 reasoning/effort 是“每轮显式选择”，实现却是 agent 级持久配置 | 改为真实语义：agent 级偏好，每轮派生透传 | `docs/clawx-design-overview.md` |

## 3. 执行顺序

1. R1-01（纯白名单 bug）
2. R1-02（payload 档位 bug，影响费用与能力）
3. R1-03（提示词重复清理）
4. R1-04（提示词安全/标题）
5. R1-05（文案）
6. R1-06（文档真相）
7. 全量聚焦验证

## 4. 验证

```bash
# 本轮必跑
pnpm exec vitest run tests/unit/agents-api-reasoning-effort.test.ts
pnpm exec vitest run tests/unit/strip-first-run.test.ts
pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.plugin-sdk.config.ts \
  src/plugin-sdk/provider-stream-shared.test.ts
pnpm exec vitest run tests/unit/runtime-intensity-policy.test.ts \
  tests/unit/chat-agent-effort-popover.test.tsx tests/unit/agent-config.test.ts
pnpm run typecheck

# 如时间允许
pnpm run lint:check
```

## 5. 回滚

- R1-01：删除 `max` 白名单项即可恢复。
- R1-02：恢复 shared wrapper 的 `xhigh/max→max` 旧映射即可。
- R1-03：merge 逻辑只删旧品牌块，不动用户其余内容；磁盘文件改动前保留备份。
- R1-04：恢复两处字符串即可。
- R1-05 / R1-06：纯文案与文档。

## 6. 后续（不在本轮）

- Linked-v1 解耦与 requested/effective 报告（W2/W3）
- PCS Catalog/Ledger/Matrix（W5）
- BOOT.md 废弃路径（W6）
- 提示词 v2 模板瘦身、skill description 压缩、PromptQualityBaseline（W8 主体）
- `prompt:snapshots:check` 在干净源码树必须先构建 codex 扩展才能跑，另行处理

## 7. 实施记录（2026-08-16）

- R1-01 已实施：`agents-api.ts` 白名单加入 `max`；新增 `tests/unit/agents-api-reasoning-effort.test.ts`（9/9 PASS）。
- R1-02 已实施：DeepSeek 共享 wrapper 改为 `minimal/low→low`、`medium/high/xhigh→high`、`max→max`；`extensions/deepseek/thinking.ts` 增加官方别名说明；新增 `src/plugin-sdk/provider-stream-shared.test.ts`（8/8 PASS）。
- R1-03 已实施：`stripLegacyClawxSection` 进入 merge 管线；`tests/unit/strip-first-run.test.ts` 更新（17/17 PASS）；当前默认 workspace 的 AGENTS.md 与 TOOLS.md 已清理旧品牌块并保留 `.bak-r1-20260816` 备份。
- R1-04 已实施：Project Context 增加不可信上下文优先级声明；`Group Chat Context` 改为 `Run Context`。
- R1-05 已实施：en/zh/ja/ru `effortHelpTooltip` 更新；`pnpm run i18n:lint` PASS。
- R1-06 已实施：`docs/clawx-design-overview.md` 三处按实现真相修正，并补充 DeepSeek 档位映射。
- 聚焦验证：5 个根 Vitest 文件 74/74 PASS；openclaw_runtime plugin-sdk 测试 8/8 PASS；ESLint 与 oxlint PASS。
- `pnpm run typecheck:web` PASS；`pnpm run typecheck:node` 仍有两处**本轮之前已存在**的错误（`embedded-agent-runner/extensions.ts:232` 与 `plugins/activation-planner.ts:138`，均不在本轮 diff 内），需另行排期修复。
- Harness spec 已创建：`harness/specs/tasks/prompt-quality-round1-bugfix.md`；`pnpm harness validate --no-diff` PASS。普通 diff-aware validate 因工作树既有大量无关 WIP 无法作为本轮干净证据，留在收口时用干净基线复跑。
- 通信回归：`pnpm run comms:replay` + `pnpm run comms:compare` PASS（全部阈值通过）。

## 8. R2 追加实施记录（继续批次）

- 修复两处既有 `typecheck:node` 错误：
  - `embedded-agent-runner/extensions.ts`：deep-frozen memory facts 通过 `structuredClone` 适配 legacy assembler 输入契约；
  - `plugins/activation-planner.ts`：`memorySlotId` 对 `null` 归一化为 `undefined`。
  - 结果：`pnpm run typecheck` 主门禁 **PASS**（node + web）。
- 模板瘦身（影响未来新建 workspace 与当前默认 workspace）：
  - `openclaw_runtime/docs/reference/templates/AGENTS.md`：删除超长 Heartbeats 应酬章节、Make It Yours、Related；
  - `TOOLS.md` / `USER.md` 模板删除示例与空表单占位；
  - 当前 `~/.openclaw/workspace` 已同步清理：AGENTS 9.9k→6.9k chars，TOOLS 2.8k→1.2k，USER 477→215。
- Skill 目录预算：`formatSkillsForPrompt` 对 description 超过 480 chars 的条目截断，保留 XML 转义；新增 3 个单测。
- `buildSystemPromptReport` 现在实际统计 `tools.listChars`（此前恒为 0），工具定义成本开始进入可观测基线。
- `prompt:snapshots:check` 仍依赖未打包的 `extensions/codex/test-api.js`，本批次未伪装为绿色，留在 R3 修复生成器或构建前置。
- 重放实测（默认 workspace + 旧 skills snapshot）：38,130 chars → **34,528 chars**；顶级 section 48 → **43**；stable prefix 30,693 chars，dynamic suffix 3,799 chars；旧品牌块、旧 Session Startup 冲突、超长 heartbeat 教程均已消失。

## 9. R3 追加实施记录

- `prompt:snapshots:check` 现在对缺失的 `extensions/codex/test-api.js` 给出可操作错误（本源码发行版未附带 Codex test-api artifact），不再抛裸 `ERR_MODULE_NOT_FOUND`。
- 新增离线质量门禁 `tests/unit/prompt-quality-budget.test.ts`：
  - fixture 默认 prompt ≤ 30,000 chars；
  - cache boundary 前 stable prefix 大于 dynamic suffix，dynamic ≤ 8,000 chars；
  - 无旧品牌块、无 `Be Proactive`、无 `Group Chat Context`；
  - 必须包含不可信上下文优先级声明；
  - 每个 skill description ≤ 483 chars；
  - `systemPromptReport.tools.listChars/schemaChars` 必须真实 > 0。
- 根 `package.json` 新增 `pnpm run prompt-quality:budget`。
- 验证：`pnpm run prompt-quality:budget` 6/6 PASS。

## 10. R4 追加实施记录

- 新增 `scripts/prompt-snapshots-check.mjs`：
  - 本地缺 Codex test-api 时默认 SKIP（明确告警），`OPENCLAW_PROMPT_SNAPSHOTS_REQUIRED=1` 时硬失败，供 CI 使用；
  - artifact 存在时执行真实 `openclaw_runtime prompt:snapshots:check`。
- 根脚本新增：
  - `pnpm run prompt:snapshots:check:available`
  - `pnpm run prompt-quality:fast`（budget + snapshot gate）
  - `agent-dev:fast` 已并入 `prompt-quality:fast`。
- 工具定义预算进入报告 schema：`tools.definitionChars = listChars + schemaChars`；PromptQualityBaseline 用 52 工具代表集断言 ≤ 60,000 chars。
- 内存中重建当前 workspace 的 skill snapshot（等价于应用重启后的效果）：
  - skills prompt：9,869 → **6,215 chars**；
  - 完整默认 prompt：38,923 → **30,788 chars / 约 7,697 tokens（-21%）**；
  - stable prefix 26,953 chars，dynamic suffix 3,799 chars，43 个顶级 section。
- `pnpm run agent-dev:fast` 已全量跑通（含新门禁）。

## 11. 阶段5：Linked-v1 核心 + requested/effective 报告（W2/W3 runtime core）

- 新增 `openclaw_runtime/src/agents/provider-effort-capability.ts`：
  - OpenAI `off/none/minimal/low/medium/high/xhigh/max`；
  - Anthropic `off/low/medium/high/xhigh/max`（minimal→low fallback）；
  - DeepSeek `off/minimal/low/medium/high/xhigh/max`，真实 effective 为 `minimal→low、medium→high、xhigh→high`；
  - 未知 provider 保持身份映射。
- `intensity-policy.ts`：
  - 新增 `RuntimeIntensityPreference` / `RuntimeIntensitySource`；
  - 新增 `resolveRequestedRuntimeIntensity`，固定 linked-v1 映射：auto/medium→baseline、minimal→minimal、low→low、high→high、xhigh/max→xhigh；
  - `resolveRuntimeIntensityPolicy` 优先 `requestedRuntimeIntensity/requestedReasoningEffort`，无新字段时保留 legacy thinkLevel 路径。
- `get-reply-run.ts`：在模型能力降档**之前**捕获 `requestedReasoningEffort` 并派生 `requestedRuntimeIntensity`，经 `FollowupRun.run` 传入 embedded attempt。
- `RunEmbeddedAgentParams` / queue 类型 / base params 增加 requested 字段；`attempt.ts` 用 requested 值解析强度，模型降档不再污染 prompt 密度。
- W3 报告：`SessionSystemPromptReport.runtimeIntensity` 新增 `requestedReasoning/effectiveReasoning/requestedIntensity/effectiveIntensity/intensitySource/couplingMode/policyAdherence`。
- 新增 harness spec：`harness/specs/tasks/runtime-intensity-linked-coupling.md`；`runtime-intensity-policy.md` acceptance 改为 requested-before-downgrade 语义。
- 验证：
  - `pnpm run typecheck` 主门禁 PASS；
  - 聚焦 Vitest 4 文件 36/36 PASS；
  - `pnpm run comms:replay` + `comms:compare` PASS；
  - 新 spec `pnpm harness validate --no-diff` PASS。

## 12. W2 UI/Main/Gateway per-send plumbing 追加

- `shared/types/agent.ts` 新增 `RuntimeIntensityPreference` + 白名单常量。
- `shared/chat/types.ts` `SendOptions` 增加 `reasoningEffort` / `runtimeIntensity`。
- `shared/host-api/contract.ts` `ChatSendWithMediaPayload` 增加两个可选字段。
- `src/stores/chat.ts` 队列与发送路径透传这两个字段。
- `electron/services/chat-api.ts` 仅做白名单校验 + Gateway RPC 透传，不做授权决策；非法值在 Main 拒绝。
- `openclaw_runtime/src/gateway/server-methods/chat.ts` 增加 `reasoningEffort` / `runtimeIntensity` 校验，并写入 `GetReplyOptions.reasoningEffortOverride/runtimeIntensityOverride`。
- `get-reply-run.ts` 显式 override 优先；`runtimeIntensityOverride` 存在时 `intensitySource: explicit`。
- 新增 `tests/unit/chat-api-effort-intensity.test.ts`（4/4 PASS）。
- 验证：`typecheck:node` / `typecheck:web` / `contract:check` / `i18n:lint` / ESLint / oxlint 全部 PASS。

## 13. W4 harness parity 追加

- `EmbeddedRunAttemptParams` / `AgentHarnessAttemptParams` 增加可选 `runtimeIntensityPolicy`；attempt 优先使用外部已解析 policy，保留本地 fallback。
- `RunCliAgentParams` 增加 `runtimeIntensityPolicy`；CLI prepare 应用：
  - promptMode（minimal/full）到 CLI system prompt；
  - skills top-k / compact transient limits；
  - `## Runtime Intensity` system prompt 行；
  - `policyAdherence: "prompt-only"` 报告（CLI 不声称 tool-result/context guard 全量生效）。
- `agent-runner-execution.ts` 在 CLI dispatch 前从 FollowupRun 的 requested/effective 字段解析 policy。
- 新增 spec `harness/specs/tasks/runtime-intensity-harness-parity.md`；新增 `tests/unit/cli-runner-intensity-policy.test.ts`（2/2 PASS）。

## 14. W5 PCS-v1.2 治理核心

- 新增 `openclaw_runtime/src/agents/prompt-governance/`：
  - `PromptSourceCatalog`：登记 `runtime.intensity.prompt`（L4 dynamic，budget 400 chars，reducer none）与 `runtime.intensity.harness_behavior`（runtime-policy，chars 0）；
  - `PromptAssemblyLedger`：append-only，只存 hash/char/metadata，不存 raw prompt；attempt 组装完成后记录 prompt-text / prompt-mode-mutation / behavior-policy 三类条目；
  - `PromptAssemblyMatrix`：deepseek/openai/anthropic × R1/R2/R3 覆盖用例，校验 intensity drift 与 adherence。
- `intensity-policy.ts` minimal 模板从 403 chars 压到 380 chars，全部策略 ≤ 400 budget。
- 新增 `tests/unit/prompt-governance.test.ts`（7/7 PASS）。
- 新增 spec：`harness/specs/tasks/prompt-capability-stratification-core.md`。

## 15. W6 BOOT.md 独立清理

- `electron/utils/agent-config.ts` 从 `AGENT_BOOTSTRAP_FILES` 与 `ALL_BOOTSTRAP_FILES` 移除 `BOOT.md`：新 agent 继承不再复制，删除 workspace 也不主动删除既有用户文件。
- `electron/services/agents-api.ts`：
  - `getBootstrap` 不再读 BOOT.md，返回 `bootMd/bootMdPath = ""` 与 `bootDeprecated` 元数据；
  - `updateBootstrap` 对 `bootMd` 写入直接拒绝，返回 `BOOT_MD_DEPRECATED`，不调用任何写文件函数。
- `shared/host-api/contract.ts`：
  - `AgentBootstrapResult.bootDeprecated` 兼容字段；
  - `AgentBootstrapUpdatePayload.bootMd` 保留用于兼容期显式拒绝；下一主版本移除。
- 新增 `tests/unit/agents-api-bootstrap-deprecation.test.ts`（2/2 PASS）。
- 新增 spec：`harness/specs/tasks/boot-md-deprecation.md`。

## 16. W7 文档 / i18n / 契约收口

- README.md / README.zh-CN.md / README.ja-JP.md：
  - Work Modes 段落改为“已退役 + Work Provider 现状”；
  - 推理强度段落更新为 linked-v1 语义、DeepSeek alias 与 CLI prompt-only 报告；
- 四语 `effortHelpTooltip` 追加 Auto 保持 baseline 密度说明；
- 契约检查 `pnpm run contract:check` PASS，BOOT_MD_DEPRECATED 兼容字段留待下一主版本移除；
- 全量回归：typecheck node+web PASS、聚焦 Vitest 7 文件 42/42 PASS、i18n PASS、comms PASS。

## 17. 收口决策（用户确认）

- Codex snapshot gate 采用方案 B：从 `prompt-quality:fast` / `agent-dev:fast` 快环移除。
  - `pnpm run prompt-quality:fast` 现在只执行 `prompt-quality:budget`。
  - `prompt:snapshots:check:available` 保留为可选 CI 证据；完整构建环境可显式设 `OPENCLAW_PROMPT_SNAPSHOTS_REQUIRED=1` 执行。
  - ClawX 快环质量门禁以 `prompt-quality:budget` 为准，不再被 Codex test-api artifact 阻塞。
- 提交边界建议见工作树 diff；推荐分 4 批提交：
  1. prompt-quality + DeepSeek + max bugfix；
  2. linked-v1 W2/W3/W4；
  3. PCS Catalog/Ledger/Matrix + W6 BOOT.md；
  4. 文档 / i18n / README 收口。
- 下一主版本移除 `bootMd` 契约兼容字段，本轮保持兼容期。
