# 三层语义收敛修复规划（2026-11-04）

- 状态：active program plan
- 驱动：agent（`driven_by: agent`，`actor: codex/mainline`）
- 基线：当前工作区 HEAD `99c142fef`；工作区存在与本计划无关的已暂存/未暂存改动，因此本计划不宣称 clean candidate。
- 关联审计结论：本文件替代不存在的 `memory-prompt-network-convergence-audit-2026-11-03.md` 链接，并以源码复核结果为准。
- 范围：Memory、提示词注入、Provider 验证/网络、重试预算四类语义裂缝的修复规划、开发、测试与验收。
- 非目标：不改变产品锁、默认值、发布状态或 GA 口径；不恢复已退役的 Runtime Memory persist；不新建“大一统管理器”、第二套 memory/context/retry/telemetry store。

## 1. 结论与修复策略

已复核的 10 项发现分为三类：

| 类别 | 发现 | 当前可达性 | 处理策略 |
|---|---|---|---|
| 当前可达契约缺陷 | 重试 attempt 身份与预算混用；多层重复计费 | 高（默认重试开启） | 立即修，P0 |
| 当前可达语义缺陷 | `valid` 单布尔表达多种事实；验证与推理网络策略分叉；验证/embedding 无统一总 deadline | 高（设置页、知识 embedding） | 修状态模型与策略解析，P1 |
| 治理/潜在缺陷 | 提示词贡献权限混用；6000 字符预算边界被误读；seal 默认关闭 | 中（取决于插件/扩展） | 先声明权限与分账，再逐 producer 收紧，P1 |
| 退役代码中的潜在缺陷 | 模型自编辑写成 human_*；更新非原子；读缓存不一致；facade 非生产入口 | 低（`persist` 恒 false） | 只做恢复前门禁与文档对齐；不为了修它们恢复 persist，P2 |

策略固定为四条：

1. **先修契约裂缝，再加能力。** 不新增通用管理器，不把旧路径包一层。
2. **同一事实只允许一个权威表达。** attempt 身份、验证状态、prompt 权限、memory provenance 都按此处理。
3. **默认关闭、显式启用、可回滚。** 任何改变用户可见行为的新语义先 shadow/warn，再 enforce；默认值变更单独决策。
4. **收益必须可复算。** 每个 P0/P1 节点在开工前冻结 metric、baseline、target、measurement；没有 baseline 的数字只能标为 estimate，不能写成收益。

## 2. 节点总览与职责分配

主树：

```text
TF-0725 三层语义收敛与可量化收益闭环（global_task, non-GA）
├─ TF-0726 M0 度量合同与基线
│  └─ TF-0727 冻结缺陷→指标→基线→门槛矩阵并产出可复算基线
├─ TF-0728 M1 重试预算正确性
│  ├─ TF-0729 分离 attempt 身份与失败预算，补幂等完成
│  ├─ TF-0730 消除 retry/fallback 与 provider transport 的重复计费
│  └─ TF-0731 重试预算故障注入与收益验收
├─ TF-0732 M2 Provider 验证与网络策略
│  ├─ TF-0733 拆分 provider validation 状态并修正 UI 语义
│  ├─ TF-0734 验证与推理共享请求策略、SSRF 与 deadline
│  └─ TF-0735 知识 embedding 总 deadline 与取消传播
├─ TF-0736 M3 提示词贡献权限与预算
│  ├─ TF-0737 定义并接入 PromptContributionAuthority 声明
│  ├─ TF-0738 让注入账本覆盖编排后追加/替换，或显式分账
│  └─ TF-0739 RC-03 seal 覆盖矩阵与负例
├─ TF-0740 M4 Memory 语义（恢复前门禁）
│  ├─ TF-0741 修正 memory 自编辑 provenance，禁止 agent→human 标签
│  ├─ TF-0742 记忆更新原子性与 DELETE 结果语义
│  ├─ TF-0743 统一读缓存失效与跨入口新鲜度
│  └─ TF-0744 Stage5 facade 采用或退役的决策与文档对齐
└─ TF-0745 M5 最终验收与收益报告
   ├─ TF-0746 全链路回归矩阵（unit/integration/E2E/negative）
   └─ TF-0747 量化收益报告与默认值/恢复决策提案
```

依赖关系：

```text
TF-0727 → TF-0729 → TF-0730 → TF-0731
TF-0727 → TF-0733 → TF-0734
TF-0727 → TF-0735
TF-0727 → TF-0737 → TF-0738
TF-0727 → TF-0737 → TF-0739
TF-0727 → TF-0741 → TF-0742 → TF-0743 → TF-0744
TF-0731, TF-0734, TF-0735, TF-0738, TF-0739, TF-0744 → TF-0746 → TF-0747
```

执行纪律：

- 同一时刻只推进一个 `in_progress` 叶节点；同一 milestone 内串行。
- M2 与 M3 的写入集不重叠，可在 M0 完成后由不同 agent 并行；但 `provider-transport-fetch.ts` 同时属于 M1/M2，必须 M1 完成后再启动 M2 的该文件改动。
- 每个叶节点的写入集、测试、验收、回滚在本文 §3 固定；不得在节点执行时临时扩大。
- 需要真人数据或 verdict 的步骤一律改写为脚本/agent 等价物，并标注 `driven_by: agent`。

## 3. 节点任务书

### 3.1 TF-0727 M0：冻结度量合同与基线

- 负责角色：`program-owner`
- 写入集：`docs/dev/semantic-convergence-program-20261104.md`、`harness/specs/tasks/semantic-convergence-remediation.md`、`scripts/semantic-convergence-baseline.mjs`、`artifacts/runs/semantic-convergence-20261104/`
- 开发：
  - 把本文 §4 的 metric 定义、公式、baseline、target 写成可执行脚本可读取的 `metricContract`。
  - 实现静态 + 动态基线：重试身份冲突、重试放大、prompt 权限覆盖、memory provenance 出现次数、memory 更新事务窗口、facade 生产消费者、`valid` 状态折叠数、验证 deadline 覆盖。
- 测试：脚本自身用固定输入断言 metric 名称、公式和 JSON schema；输出必须含 commit、dirty、generatedAt、每条 metric 的 method 和 limitation。
- 验收：脚本退出码 0；JSON 可读；每条 metric 有 `method` 与 `limitation`；数值与源码事实一致；不把静态计数写成运行时效果。
- 量化：产出 `baseline.json`；所有后续节点的 target 相对此文件。
- 回滚：只删脚本/文档，不影响产品。

### 3.2 TF-0729 M1-1：分离 attempt 身份与失败预算

- 负责角色：`retry-budget-owner`
- 写入集：`openclaw_runtime/src/agents/request-attempt-budget.ts`、`openclaw_runtime/src/agents/request-attempt-budget.test.ts`、`docs/dev/network-protocol-reliability/retry-budget.md`
- 开发：
  - 增加单调递增 `nextPhysicalAttempt`，与 `usedCount`（失败预算占用）分离；`physicalAttempt` 只作身份，不再等于余额。
  - `completeAttempt` 用唯一身份查记录；重复完成幂等；成功只释放一次预算。
  - 保留现有 API 形状，避免下游大改；补充注释说明“身份 ≠ 余额”。
- 测试：
  - `success → failure` 后两条记录 ID 不同、outcome 正确；
  - `failure → success → failure` 不覆盖；
  - 重复 `completeAttempt` 只释放一次；
  - 现有 6 个测试保持通过。
- 验收：`duplicate_attempt_id_rate = 0`；`idempotent_double_complete_delta = 0`；聚焦 vitest 全绿。
- 量化：TF-0727 的 `retry.duplicateAttemptIdRate` 从基线（S1 场景 100%）降到 0。
- 回滚：单文件 revert；不改默认重试次数。

### 3.3 TF-0730 M1-2：消除多层重复计费

- 负责角色：`retry-budget-owner`
- 写入集：`openclaw_runtime/src/agents/request-attempt-budget.ts`、`openclaw_runtime/src/agents/provider-transport-fetch.ts`、`openclaw_runtime/src/agents/model-fallback.ts`、`openclaw_runtime/src/agents/sessions/agent-session.ts`、`openclaw_runtime/src/infra/retry.ts`、对应测试与 `docs/dev/network-protocol-reliability/retry-budget.md`
- 开发：
  - 明确“计费点”：只有实际出站 provider 请求消耗物理 attempt；auto-retry/fallback 只做 `canRetry()` 门禁和非计费决策记录。
  - 增加 `noteLayerDecision`（或等价只读标注）避免上层再占预算；保证 SDK retry 的真实物理请求仍各计一次。
  - 保留 `Retry-After` 下界与失败元数据。
- 测试：
  - 模拟 `provider fail → auto-retry → provider fail → auto-retry → provider success`：物理请求 3 次，charged 3，amplification 1.0，最终成功；
  - 预算耗尽时在发送前失败，不产生额外 outbound；
  - 现有 model-fallback/retry 测试按新语义更新，不得删负例。
- 验收：`attempt_amplification ≤ 1.0`；`retry_recovery_rate = 1/1`（3 次物理尝试内恢复）；无双重计数。
- 量化：基线 amplification 2.0（4 charged / 2 physical）→ 1.0；相同故障序列从“第 3 次被拒绝”变为“第 3 次成功”。
- 回滚：恢复旧计费点即可；不改 `maxRetries` 默认值。

### 3.4 TF-0731 M1-3：重试预算故障注入与收益验收

- 负责角色：`verification-owner`
- 写入集：`tests/unit/request-attempt-budget.invariants.test.ts`、`tests/e2e/retry-budget-fault-injection.spec.ts`、`artifacts/runs/semantic-convergence-20261104/retry/`
- 开发：只写测试与证据，不改生产实现。
- 测试：
  - 序列矩阵：成功/失败交错、跨层、预算边界、Retry-After 超限；
  - 真实出站计数器：mock provider 返回 503/503/200，断言 outbound 3 次、最终成功；
  - 负例：401/403 不重试；context overflow 不重试；预算耗尽 fail-closed。
- 验收：矩阵 100% 通过；每条断言可从 JSON 报告复算；报告中区分 unit、E2E、静态证据。
- 量化：输出 `retry-recovery-before.json`（基线）与 `retry-recovery-after.json`（修复后），字段 `physical_requests`、`charged_attempts`、`recovered`。
- 回滚：测试可独立 revert。

### 3.5 TF-0733 M2-1：拆分 provider validation 状态

- 负责角色：`provider-network-owner`
- 写入集：`electron/services/providers/provider-validation.ts`、`electron/services/providers-api.ts`、`shared/host-api/contract.ts`、`src/components/settings/ProvidersSettings.tsx`、`src/pages/Setup/ProviderModelSteps.tsx`、四语言 `settings/setup` locale、对应测试
- 开发：
  - 用结构化状态替代单布尔：`reachable`、`auth`、`protocol`、`model`、`rateLimited`、`retryAfterMs`、`ready`、`reason`。
  - 保留 `valid` 兼容字段一个 release，但语义固定为 `auth === 'valid' && protocol !== 'incompatible'`，不得把 429 或非鉴权 400 当 ready。
  - UI 文案分层：`Credentials verified` 只在 `ready=true` 时显示；429 显示限流与等待；400 显示协议/参数错误。
  - Setup 账号写 `validation.status='valid'` 的时机后移到模型确认成功，避免半途退出留下假 ready。
- 测试：12 个 stub 场景（200/401/403/429/400-auth/400-param/404-model/5xx/timeout/DNS/SSRF-blocked/proxy）；每个场景唯一期望状态；UI E2E 覆盖 429 与非鉴权 400 不再显示 verified。
- 验收：`false_ready_rate = 0/12`；`state_dimension_coverage = 6/6`；旧 `valid` 调用方仍编译。
- 量化：基线 source-derived `valid` 折叠 3 类（2xx/429/400-non-auth）→ 修复后只有 2xx+model 成功为 ready；误报场景 2/12 → 0/12。
- 回滚：保留 `valid` 兼容层；UI 可按 flag 回退旧文案。

### 3.6 TF-0734 M2-2：验证与推理共享请求策略

- 负责角色：`provider-network-owner`
- 写入集：`electron/services/providers/provider-validation.ts`、`electron/utils/proxy-fetch.ts`、`openclaw_runtime/src/agents/provider-transport-fetch.ts`（只读复用策略解析）、`shared/host-api/contract.ts`、测试
- 开发：
  - 抽出可复用的 `resolveProviderRequestPolicy`（SSRF、private-network、deadline、proxy、retry class），验证与推理都调用同一解析器；Electron net.fetch/NetworkPool 与 Node guarded fetch 可保留不同 socket，但策略输入与指纹一致。
  - 验证请求必须带总 deadline 与 AbortSignal；错误返回结构化 `policyFingerprint`、`stage`、`blockedReason`。
  - 对 localhost/私网/metadata 地址的验证请求与推理同样 fail-closed；显式 allowlist 例外需记录。
- 测试：同一 target 在验证与推理下得到相同 allow/deny；12 场景中 SSRF-blocked 必须在验证阶段被拒；deadline 到期中止；proxy 开关下策略指纹一致。
- 验收：`policy_parity_rate = 100%`（或文档化例外 0 个）；`validation_deadline_coverage = 4/4`；无新增 CORS/直连 renderer 路径。
- 量化：基线 0% 共享策略 → 100%；验证通过但推理被 SSRF/deadline 拒绝的场景数从“未知”变为可枚举且为 0。
- 回滚：策略解析器双读旧路径；按 provider 白名单逐步启用。

### 3.7 TF-0735 M2-3：知识 embedding 总 deadline

- 负责角色：`knowledge-embedding-owner`
- 写入集：`electron/services/knowledge-embedding-provider.ts`、`electron/services/knowledge-api.ts`、`tests/unit/knowledge-embedding-deadline.test.ts`
- 开发：
  - `embedBatch` 接受总 deadline/AbortSignal；每批 30s 只是单批上限，整体不得超过调用方总预算（默认 120s 或配置值）。
  - 批次间检查 `signal.aborted`；超时返回结构化 `deadline_exceeded`，不吞错。
  - `semantic` 回答路径把总 deadline 传入；部分结果不得伪装成完整排序。
- 测试：100 条 / 13 批、每批 30s 的 fake timer 场景，总耗时不超过总 deadline；abort 后不再发下一批；部分失败返回明确状态。
- 验收：`worst_case_operation_ms ≤ total_deadline_ms`；取消传播覆盖 3 个调用点。
- 量化：基线最坏 `30s × ceil(N/8)`（100 条 = 390s）→ 修复后 ≤120s；超时后不再继续批次。
- 回滚：保留单批 30s；总 deadline 可配置为 Infinity 仅测试用。

### 3.8 TF-0737 M3-1：PromptContributionAuthority 声明

- 负责角色：`context-prompt-owner`
- 写入集：`openclaw_runtime/src/context-engine/context-candidate.ts`、`types.ts`、`prompt-contribution-authority.ts`、`context-orchestrator.ts`；`openclaw_runtime/src/plugins/hook-before-agent-start.types.ts`、`hook-types.ts`、`types.ts`、`registry.ts`、`hooks.ts`；对应测试、规范与文档。注册器和逐 producer runner 是权限校验的真实入口，必须同批接线。
- 开发：
  - 定义四类权限：`append_data`（消息/上下文资料）、`append_instruction`（system 上下文）、`replace_system_prompt`、`replace_messages`。
  - 每个 producer 注册时声明 authority、source、scope、reason；未声明者默认只允许 `append_data`，尝试更强 mutation 时 fail-closed 或 warn→deny（按配置）。
  - `ContextCandidate.target` 与 hook 返回字段映射到 authority；`systemPrompt` 替换必须有显式 `replace_system_prompt`。
- 测试：5 个 mutation 字段全覆盖；未声明 producer 的 `systemPrompt`/`message_replacement` 被拒；声明后可放行；负例不得改为静默降级。
- 验收：`authority_declaration_coverage = 5/5`；`ungoverned_mutation_count = 0`（在 enforce 模式下）。
- 量化：基线 0/5 字段有权限声明 → 5/5；高权限 producer 数量可枚举，新增高权限 producer 必须显式登记。
- 回滚：warn-only 模式保留；按 producer 白名单逐步 enforce。
- 默认行为：既有调用保留 warn 模式；显式 enforce 是本节点的验收边界。未注册高权限贡献在 warn 模式可继续执行且有警告/lineage，不能宣称生产默认全面阻断。候选声明由 admission 参数传入，hook 声明由 `api.on` 的 `promptContribution` 注册项传入。
- 宿主可通过 `OPENCLAW_PROMPT_AUTHORITY_MODE=enforce` 选择 enforce；显式入参优先，非法环境值拒绝。内置来源使用真实操作对应的固定 authority/scope 声明，不得按候选请求目标自动授予权限，也不登记 synthetic test ID。

### 3.9 TF-0738 M3-2：注入账本覆盖与分账

- 负责角色：`context-prompt-owner`
- 写入集：`openclaw_runtime/src/context-engine/context-orchestrator.ts`、`turn-injection-budget.ts`、`openclaw_runtime/src/agents/embedded-agent-runner/run/attempt.ts`、`context-final-snapshot.ts`、测试与 `docs/dev/context-orchestrator.md`
- 开发：
  - 明确两层预算：`managed_injection_chars`（6000，受账本管理）与 `total_request_tokens`（provider 实际）。
  - orchestrator 之后追加的 `runtimeIntensitySystemPrompt`、`dcsDepsResolution.degradationNotice` 进入同一账本或单独 `post_orchestrator` 分账；无 `turnId` 路径必须显式标 `unbudgeted=true` 并在 diagnostics 中可见。
  - `ContextFinalSnapshot` 增加 `budgetCoverage`：`managedChars`、`postOrchestratorChars`、`totalPromptChars`、`unaccountedChars`。
- 测试：构造 orchestrator 后追加 3 段内容，断言 `unaccountedChars=0` 或全部列入 post 分账；无 turnId 路径 diagnostics 可见；6000 字符截断不再被误读为总请求预算。
- 验收：`accounted_char_ratio = 1.0`（managed + post 分账）；`unbudgeted_turn_count = 0`（正常 embedded attempt）；快照字段可回读。
- 量化：基线 managed/total <1 且无 post 分账 → 1.0；输出每个 turn 的 `unaccountedChars` P95/P99。
- 回滚：保留旧 6000 行为；分账字段 additive。

### 3.10 TF-0739 M3-3：RC-03 seal 覆盖矩阵

- 负责角色：`context-prompt-owner`
- 写入集：`openclaw_runtime/src/context-engine/rc03-seal-hook.ts`、`seal-registry.ts`、`rc03-seal-wiring.test.ts`、`tests/unit/rc03-seal-coverage.test.ts`、相关文档
- 开发：
  - 枚举所有 semantic producer 与 transport transform，形成 `producer → mutates → pre/post seal` 矩阵。
  - seal-off 时明确 `sealCoverage=disabled`，不得声称覆盖；seal-on 时未注册 producer 必须 fail-closed。
  - 增加负例：未注册 producer 修改 system prompt、seal 后 semantic transform、重复注册。
- 测试：矩阵 100% 覆盖；seal-on 正例 sealed；seal-off 不产生假 sealed 声明；负例被拒。
- 验收：`unregistered_semantic_mutations = 0`（seal-on）；`seal_claims_without_flag = 0`。
- 量化：基线 seal 默认关闭且无覆盖矩阵 → 覆盖矩阵 100%，seal-on 下 0 未注册 mutation。
- 回滚：保持默认关闭；矩阵只读。

### 3.11 TF-0741 M4-1：Memory provenance 门禁

- 负责角色：`memory-governance-owner`
- 写入集：`openclaw_runtime/src/runtime-core/memory-self-edit-tools.ts`、`memory-self-edit-adapter.ts`、`memory-context.ts`、`tests/unit/memory-self-edit-provenance.test.ts`、`docs/dev/memory-control-plane.md`
- 前置：本节点不恢复 `persist`；只修代码与加门禁。
- 开发：
  - 删除模型自编辑产生的 `human_confirmation` / `human_approved` / `promotedBy: human`。
  - 引入 `agent_self_edit` provenance，`verificationStatus: unverified` 或 `agent_approved`（按现有枚举最小扩展）；若 schema 不支持，先加类型与迁移说明，不写库。
  - 加运行时断言：模型可调用工具不得生成 `human_*`；测试锁定。
- 测试：update/forget/strengthen 三条路径 provenance 正确；静态扫描 `human_*` 出现 0；即使 persist 被未来打开也不产生 human 标签。
- 验收：`agent_human_label_count = 0`；`persist` 仍 false；不改变现有退役测试。
- 量化：基线 3 处源码标签 → 0；未来恢复 persist 的 P0 风险关闭。
- 回滚：只改标签与断言；不触库。

### 3.12 TF-0742 M4-2：记忆更新原子性与 DELETE 结果语义

- 负责角色：`memory-governance-owner`
- 写入集：`openclaw_runtime/src/runtime-core/memory-runtime-integration.ts`、`memory-persistence.ts`、`memory-self-edit-tools.ts`、测试
- 开发：
  - 为 update/supersede 提供单事务或补偿状态机：写入新事实、失效旧事实、写关系三步要么全成，要么留下可对账的 `unknown`，不得静默部分成功。
  - `DELETE` 返回 `applied` + `persisted=true`（若目标已失效则 `already_applied`），不再返回 `skipped/flag_disabled`。
  - 失败注入覆盖三步各自失败。
- 测试：3 个注入点 × 2 条路径；断言无“新旧同时有效”和“旧失效新缺失”的窗口；DELETE 返回语义正确。
- 验收：`partial_update_windows = 0`；`delete_reported_skipped_after_effect = 0`。
- 量化：基线 2 路径 × 3 独立事务 = 6 个窗口 → 0；故障注入 6/6 通过。
- 回滚：保留旧路径 feature flag；默认仍退役。

### 3.13 TF-0743 M4-3：读缓存失效与跨入口新鲜度

- 负责角色：`memory-governance-owner`
- 写入集：`openclaw_runtime/src/runtime-core/memory-pre-reply-injection.ts`、`memory-query-tool.ts`、`memory-self-edit-adapter.ts`、`tests/unit/memory-read-consistency.test.ts`
- 开发：
  - 写路径成功后统一调用 cache invalidation（同进程 + 可扩展 pub/sub 接口）；读路径暴露 `loadedAt`/`sourceRevision`。
  - `memory_query` 与 self-edit 共享同一 revision 检查；或明确两者不同 scope 并在返回值标注。
- 测试：写后立即读，两个入口都看到新值；TTL 内不返回旧值；多进程模拟（可选）返回 `stale` 标记而不是假装 fresh。
- 验收：`stale_read_max_seconds = 0`（同进程）；跨进程有显式 `stale` 标记。
- 量化：基线 TTL 30s 窗口 → 同进程 0s；跨进程可见性从“未知”变为有界标记。
- 回滚：保留 TTL；invalidation 可关闭。

### 3.14 TF-0744 M4-4：Stage5 facade 采用或退役

- 负责角色：`memory-governance-owner`
- 写入集：`openclaw_runtime/src/context-engine/stage5-memory-facade.ts`、`stage5-golden-run.ts`、`docs/dev/memory-control-plane.md`、`harness/specs/tasks/context-control-plane-stage5.md`
- 开发（二选一，必须在节点内记录决策）：
  - 采用：把 facade 接入至少一个生产 memory 读入口，删除重复兼容工具名映射。
  - 退役：标记 deprecated，移出生产导出，保留 golden-run 只读证据；同步 `memory-self-edit-tools.ts` 文件头“未注册”陈述。
- 测试：采用路径有 1 个生产消费者 + 契约测试；退役路径无生产引用 + 文档一致。
- 验收：`production_consumer_count = 1` 或 `deprecated_with_zero_production_refs = true`；文件头/开关/文档一致。
- 量化：基线 0 生产消费者 + 错误注释 → 0 或 1（明确），文档不一致项 0。
- 回滚：决策可逆；退役保留兼容导出。

### 3.15 TF-0746 M5-1：全链路回归矩阵

- 负责角色：`verification-owner`
- 写入集：`tests/unit/semantic-convergence-*`、`tests/e2e/semantic-convergence-*`、`artifacts/runs/semantic-convergence-20261104/final/`
- 开发：只写测试与证据；按 requirement→journey→command→oracle→negative→artifact→verdict 建矩阵。
- 测试：
  - 所有 P0/P1 节点的 positive + negative + boundary；
  - 跨层：Retry 与 provider validation 的错误分类一致；prompt authority 与 seal 的 producer 矩阵一致；memory 退役门禁仍生效。
  - E2E：设置页 429/400 文案、真实 provider 失败恢复、seal-on 负例、memory 工具未注册。
- 验收：矩阵 100% 有 verdict；失败项不得用 skip 掩盖；同一候选可复算。
- 量化：`verified_findings_ratio`、`negative_case_pass_rate`、`regression_suite_count`。
- 回滚：测试独立。

### 3.16 TF-0747 M5-2：量化收益报告与决策提案

- 负责角色：`program-owner`
- 写入集：`docs/dev/semantic-convergence-benefit-20261104.md`、`artifacts/runs/semantic-convergence-20261104/final/report.json`、Task Forest 提案
- 开发：汇总 §4 指标，输出 before/after、置信区间（若有重复样本）、成本（测试时长、token/字符开销）、未测边界。
- 测试：报告中的每个数字可由脚本复算；不得把静态计数写成运行时收益；不得把 agent 证据写成 real-human。
- 验收：报告含 `decision.status ∈ {keep-retired, promote-shadow, enable-opt-in, block}`；默认值变更单独列出并等待所有者决策；所有 P0/P1 发现要么 resolved，要么有明确 residual。
- 量化：总收益 = 加权记分卡（见 §4.3），并单列“未量化项”与“负收益/成本”。
- 回滚：报告只读；决策提案未应用则保持现状。

## 4. 收益量化合同

### 4.1 指标分层

| 层 | 指标 | 用途 |
|---|---|---|
| 正确性 | duplicate_attempt_id_rate、partial_update_windows、false_ready_rate、unregistered_semantic_mutations | 直接证明契约裂缝是否关闭 |
| 覆盖 | authority_declaration_coverage、state_dimension_coverage、policy_parity_rate、seal_coverage | 证明修复不是只覆盖一个样例 |
| 用户影响 | retry_recovery_rate、validation_false_success_rate、stale_read_max_seconds、deadline_exceeded_rate | 证明用户可见行为改善 |
| 成本 | attempt_amplification、accounted_char_ratio、worst_case_operation_ms、extra_test_seconds | 证明没有用放大重试/上下文换收益 |
| 证据质量 | verified_findings_ratio、negative_case_pass_rate、recomputable_metric_ratio | 防止自证和口径漂移 |

### 4.2 核心指标定义与基线

| ID | 定义 | 公式 | 基线（TF-0727 产出） | 目标 | 测量 |
|---|---|---|---|---|---|
| RETRY-1 | attempt 身份冲突率 | 重复 physicalAttempt 的记录数 / 总记录数 | S1 场景 2/2 = 100% | 0% | 动态导入 `RequestAttemptBudget`，跑固定序列 |
| RETRY-2 | 重试放大系数 | charged_attempts / physical_requests | 4/2 = 2.0 | ≤1.0 | 模拟 provider+auto-retry 两层 |
| RETRY-3 | 预算内恢复率 | 在 maxRetries 内成功的故障序列 / 总序列 | 0/1（第 3 次被拒绝） | 1/1 | 故障注入 E2E |
| VALID-1 | 假 ready 率 | 返回 ready 但真实调用会因 auth/protocol/model 失败的场景数 / 场景数 | 2/12（429、非鉴权 400） | 0/12 | 12 场景 stub 矩阵 |
| VALID-2 | 状态维度覆盖 | 已表达的独立状态数 / 6 | 1/6（单布尔） | 6/6 | 类型与契约检查 |
| NET-1 | 验证/推理策略一致率 | 共享策略解析的验证请求 / 总验证请求 | 0% | 100% | 策略指纹对比 |
| NET-2 | 验证 deadline 覆盖 | 带总 deadline 的 probe 数 / 4 | 0/4 | 4/4 | 静态 + 运行时探测 |
| EMB-1 | 最坏操作时长 | 批次数 × 单批上限 | 30s × ceil(N/8) | ≤总 deadline | fake timer |
| PROMPT-1 | 权限声明覆盖率 | 已声明 authority 的 mutation 字段 / 5 | 0/5 | 5/5 | 静态清单 + 运行时注册 |
| PROMPT-2 | 注入字符入账率 | (managed + post_orchestrator) / total_injected | <1 | 1.0 | `ContextFinalSnapshot` |
| PROMPT-3 | 未注册语义 mutation | seal-on 下未注册 producer 数 | 未测（seal 默认关） | 0 | seal 矩阵 |
| MEM-1 | agent→human 标签数 | 模型工具产生的 human_* 标签数 | 3 处源码 | 0 | 静态扫描 |
| MEM-2 | 部分更新窗口数 | 独立事务数 - 1（每条更新路径） | 2 路径 × 3 步 = 4 个中间窗口 | 0 | 故障注入 |
| MEM-3 | 同进程陈旧读最长秒数 | 写后到读入口看到新值的最大间隔 | ≤30s（TTL） | 0s | 写后立即读 |
| FACADE-1 | 生产消费者数 | 非测试、非 golden-run 的消费者 | 0 | 0（退役）或 1（采用） | 静态引用 |
| EVID-1 | 已验证发现比例 | 有磁盘证据的发现 / 10 | 10/10 已源码复核，0 个运行时修复 | 修复后 10/10 | 节点证据表 |
| EVID-2 | 负例通过率 | 通过的负例 / 总负例 | 未测 | 100% | 测试报告 |

说明：

- 基线中的“源码计数”是静态事实，不是运行时效果；报告必须标注 `method: static`。
- 任何“用户可见收益”只在对应 E2E/故障注入有 before/after 时计入；否则标 `not-measured`。
- 同一候选的 before/after 必须使用同一 fixture、同一 seed、同一命令；否则不得比较。
- 每个数字必须能从 `artifacts/runs/semantic-convergence-20261104/baseline.json` 或后续 `final/report.json` 复算。

### 4.3 总收益表达

使用加权记分卡，而不是单一“收益百分比”：

```text
benefit_score =
  0.35 × correctness_gain
+ 0.25 × user_impact_gain
+ 0.20 × coverage_gain
+ 0.10 × cost_efficiency_gain
+ 0.10 × evidence_quality_gain
```

每项归一化到 0..1，权重在 TF-0727 冻结；任何权重变更必须新开节点并记录原因。总分只用于排序，不作为发布批准或 GA 依据。

## 5. 开发、测试、验收全流程

每个叶节点固定七步：

1. **Spec**：在 `harness/specs/tasks/` 写窄任务合同，运行 `pnpm harness context --spec <spec>`。
2. **Baseline**：引用 TF-0727 的 metric；没有 baseline 的先补测量，不得直接改代码。
3. **Implement**：只改本节点写入集；跨节点文件按依赖串行。
4. **Unit**：positive + negative + boundary；必须包含至少一个“修复前会失败”的测试。
5. **Integration/E2E**：涉及用户可见行为或跨层契约时必须补；UI 改动按仓库规则补 Playwright。
6. **Artifact**：`artifacts/runs/semantic-convergence-20261104/<node>/report.json`，含 commit、dirty、命令、退出码、计数、限制。
7. **Acceptance**：逐条从磁盘读证据；满足 R3/R4 才 `done`，否则 `review_needed` 并写 gap。

## 6. 里程碑与顺序

| 阶段 | 节点 | 目标 | 入口条件 | 出口条件 |
|---|---|---|---|---|
| M0 | TF-0727 | 冻结度量与基线 | 本计划获批 | baseline.json 可复算 |
| M1 | TF-0729/30/31 | 重试预算正确性 | M0 done | RETRY-1/2/3 达标 |
| M2 | TF-0733/34/35 | 验证与网络策略 | M0 done；M1 不阻塞（共享文件串行） | VALID/NET/EMB 达标 |
| M3 | TF-0737/38/39 | 提示词权限与预算 | M0 done | PROMPT-1/2/3 达标 |
| M4 | TF-0741/42/43/44 | Memory 恢复前门禁 | M0 done；不恢复 persist | MEM/FACADE 达标 |
| M5 | TF-0746/47 | 终验与收益 | M1–M4 叶节点 done | 10/10 发现 resolved 或有 residual |

建议排期（agent 工作日，非承诺）：

- M0：0.5 天
- M1：2–3 天
- M2：2–3 天
- M3：3–4 天
- M4：2–3 天（不含恢复决策）
- M5：2–3 天

## 7. 风险、回滚与停止条件

| 风险 | 影响 | 缓解 | 停止条件 |
|---|---|---|---|
| 重试语义改变导致重试次数变化 | 用户可见延迟/费用 | 先 shadow 记录，再 enforce；保留旧计费点开关 | 失败率上升 > 基线 +1pp |
| 验证状态模型破坏旧调用方 | 设置页/Setup 失败 | 保留 `valid` 兼容字段一个 release | 旧 contract 测试失败 |
| 提示词权限 enforce 拒绝第三方插件 | 插件兼容性 | warn→deny 分阶段；producer 白名单 | 未登记 producer 影响生产启动 |
| seal 开启后拒绝合法 transform | 请求失败 | 先只读矩阵，后 enforce；kill switch | unregistered mutation 无法在测试中清零 |
| Memory 修改被误认为恢复能力 | 产品语义混乱 | 节点明确 `persist` 不变；文档标注 retired | 任何默认值/开关变更未走决策 |
| 工作区脏导致证据不可复算 | 证据链不完整 | 记录 dirty、只对节点文件做 path-limited commit；最终 clean candidate 另起 | 无法区分本节点改动与他人改动 |

## 8. 验收口径

程序级完成必须同时满足：

1. 10 项发现逐项有节点、证据、verdict；无“已读源码=已修复”的替代。
2. 每个 P0/P1 节点至少一个 positive、一个 negative、一个 boundary 测试。
3. 所有数字有 baseline 与 after，且可复算；未测量项明示 `not-measured`。
4. 默认值、产品锁、发布状态未变；Memory persist 仍 false。
5. 最终报告给出 `decision.status`，不得自动宣称 GA 或 production-ready。
6. 不声称 real-human 证据；所有 agent 产物标注 `driven_by: agent`。

## 9. 与现有节点的关系

- 本程序不挂在已 deprecated 的 `TF-0010`，也不复用 `TF-0628` 的只读骨架范围；`TF-0628` 的“不改运行时行为”与本程序的修复目标冲突。
- 本程序与 `TF-0571` 的 Windows 功能验收互补：`TF-0571` 管产品旅程，本程序管语义契约；两者不互相替代。
- 重试节点补充而非替代 `TF-0438` 的历史实现；`TF-0438` 的 acceptance 仍然有效，新节点修复其实现与验收之间的缺口。
- Memory 节点补充而非替代 `TF-0500`/`TF-0697` 的退役决定；在恢复 persist 的新决策出现前，这些节点只做代码与文档门禁。

## 10. 执行记录

- 2026-11-04：TF-0727 完成，产出 `artifacts/runs/semantic-convergence-20261104/baseline-before-fix.json` 与 `baseline-after-fix.json`；14 个 metric 可复算，固定时间重复运行哈希一致。
- 2026-11-04：TF-0729 在 worktree `D:\ClawX-work\semantic-convergence-20261104` 完成 clean-candidate 收口（commit `29b75de9e`）：动态契约 3/3，既有重试 33/33；RETRY-1 1→0。
- 2026-11-04：TF-0733 完成：`ProviderValidationResult` 六维状态 + `ready` 门禁；429 解析 Retry-After，非鉴权 400 归为 protocol-error；Setup 的 `validation='valid'` 后移到模型确认。静态 VALID-1 3→0、VALID-2 1→6；12 场景矩阵 false_ready 2/12→0/12；provider 相关单测 74/74。
- 2026-11-04：TF-0734 完成：新增共享 provider network policy（SSRF/private-network/exact-origin trust/proxy + 稳定 fingerprint），验证 4 类 probe 共用一个 15s 总 deadline 与 AbortSignal，preflight 返回 policyFingerprint/stage/blockedReason。NET-1 0→1、NET-2 0→1、NET-3 0→4、NET-4 0→1；provider/network 相关单测 170/170。
- 下一节点：TF-0735（知识 embedding 总 deadline 与取消传播）。
