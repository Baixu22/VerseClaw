# 错误与问题治理：文档核查与 Issue 沉淀（2026-10-09）

- 性质：审计与修复建议，**不是已生效的治理决策或实现验收报告**。
- driven_by: agent；actor: codex-governance-audit。
- 总追踪：[错误与问题治理 #125](https://github.com/Baixu22/VerseClaw/issues/125)。
- 本轮新增10条问题 Issues（4个P1、6个P2）及1条总追踪；已从 GitHub 回读全部标题、正文、标签和 OPEN 状态。
- 核查前检索108条开放/关闭 Issues。成本归因与已有 [#112：消息到调用身份映射](https://github.com/Baixu22/VerseClaw/issues/112) 建立依赖，不重复建底层映射。

## 1. 输入与核查基线

输入为用户提供的《错误与问题治理、接口开放——对齐 Manus 治理基线》及附带硬规则片段，日期2026-10-09。原始输入 SHA-256：2bcfba574604422ace49e4d474d2ae365d4edb14f93eda120840a5016f56efb1。

- 当前工作区 HEAD：9a48096f94a5df7cd0c9b127c929e57f597d6c50。
- 核查并用于源码链接的 GitHub main：7573115a797e4992ae77cf5425fa62763d9a4691。
- 41个被引用源码文件已与该 main 逐文件比较，忽略CRLF后相同；引用行号范围已检查。
- 读取了仓库工作流/交接、当前规范、Task Forest 当前图、相关实现与相邻测试；没有修改现有 Task Forest、运行时代码、产品锁、权限、端点启用状态或其他脏文件。
- Manus 外部服务与引用网页未独立复测。本报告以用户文档为待校准的治理草案，不能视作 Manus 产品行为认证。

## 2. 核心判断：已有基础，主要缺口在边界和接线

1. **Host API 不是没有信封或请求 ID。** 已有 HostResponse、四类 Main 错误码与合法请求 ID；真正问题是 Renderer 丢弃结构化信息，以及部分来源归类过粗。
2. **当前传输不是 WS→HTTP→IPC fallback。** 现行规则是 Renderer typed IPC、Main 持有 Gateway WS；不应借本治理文档恢复旧链路。
3. **用户错误分类不只有两个。** Runtime 有两类特化文案，前端另有9类 AppError 及统一用户错误出口；应补映射/i18n，而不是再造一套。
4. **后台工作已经建模并显示。** 确认的缺陷是读取失败没有诚实展示 unknown；没有证明该路径把 stopped 用作整体完成、清场或收口。
5. **问题检测、脱敏持久化和导出已存在。** 缺的是跨运行签名聚合、独立发生次数去重及 Problem 状态闭环。
6. **用量历史和部分失败用量累加已存在。** 缺的是失败/重试与用量的可靠关联；usageStatus:error 是采集/解析质量，不是 turn 失败。
7. **未知等待不能自动批准，也不能变成真人前置。** 用 agent 模拟保守拒绝/待决与已知 schema 的合法交互，验收产物如实标注。

## 3. Issue 清单与建议方案

| Issue | 问题 | 最小方案 |
|---|---|---|
| [#115](https://github.com/Baixu22/VerseClaw/issues/115) | [P2] 错误治理草案与现有 typed IPC/错误资产不一致，硬规则存在真人前置和未验证承诺 | 校准现有资产和 typed IPC 事实；消除真人前置及歧义，接入可执行规则。 |
| [#116](https://github.com/Baixu22/VerseClaw/issues/116) | [P1] 五类 FailoverReason 缺少兼容映射，Chat SSE 兜底把失败输出为正常 stop 和零用量 | 补穷尽映射；SSE 用明确失败事件终止，不伪造正常完成或零用量。 |
| [#117](https://github.com/Baixu22/VerseClaw/issues/117) | [P1] OpenAI 兼容错误边界原样返回 rawError，绕过已有脱敏与 500 字符预算 | 在统一兼容出口复用脱敏器和500字符预算，覆盖所有调用路径。 |
| [#118](https://github.com/Baixu22/VerseClaw/issues/118) | [P1] invokeHost 丢弃结构化错误码和请求 ID，TIMEOUT 到 UI 后可退化为 UNKNOWN | 复用 HostResponse/AppError，保留错误码、请求 ID 与安全归因元数据。 |
| [#119](https://github.com/Baixu22/VerseClaw/issues/119) | [P1] retryAsync 在 Retry-After 超过 maxDelayMs 时提前重试，违反上游最早重试时间 | Retry-After 作为下界；预算不足就停止/延期，不提前发送。 |
| [#120](https://github.com/Baixu22/VerseClaw/issues/120) | [P2] 统一用户错误出口仍硬编码英文，高频 provider 错误缺少责任与行动指引 | 沿用错误出口，补四语言分类文案及“发生什么/责任/下一步”。 |
| [#121](https://github.com/Baixu22/VerseClaw/issues/121) | [P2] 后台活动读取失败被静默展示为空，Session Activity 缺少 unknown 状态 | 贯穿来源可用性，区分 known-empty 与 unknown，复用告警/重试。 |
| [#122](https://github.com/Baixu22/VerseClaw/issues/122) | [P2] Trace Issues 尚未接入跨运行 Problem 聚合、状态流转与证据导出 | 复用 trace 索引及 Support Bundle，按事件去重后聚合 Problem 并导出证据。 |
| [#123](https://github.com/Baixu22/VerseClaw/issues/123) | [P2] 已启用的 OpenAI 兼容 HTTP 缺少认证成功后的端点请求预算 | 复用进程内限流器，添加认证后的端点预算；不直接采用100 RPM默认。 |
| [#124](https://github.com/Baixu22/VerseClaw/issues/124) | [P2] 用量历史无法关联失败与重试成本，usageStatus 被用于采集质量而非执行结果 | 在已有用量历史上消费 #112 的调用身份，增加失败/重试归因，不另建账本。 |

每条 Issue 都包含实际源码锚点、影响/适用条件、建议方案、自动化验收和未验证边界。这里的 OPEN 是核查时状态；后续以 GitHub Issue 为准，不把本表当作第二套任务状态机。

## 4. 已执行的验证

### 真实模块、纯合成输入的反例

| 检查 | 实际观察 | 能证明/不能证明 |
|---|---|---|
| FailoverReason 映射 | 15类中10类有映射；refusal/empty_response/no_error_details/unclassified/unknown 返回 undefined | 证明 helper 缺项；SSE 后果另由实际 catch/写入路径追踪，未启动HTTP服务 |
| 兼容错误隐私预算 | 2061字符输入原样2061字符输出，合成api_key标记保留；既有脱敏函数输出500字符且标记消失 | 证明出口缺保护；不是实际凭据外泄事件 |
| Host 错误信息 | TIMEOUT + deadline exceeded 返回到 invokeHost 后变普通 Error，code/requestId/details 缺失，UI归一化为 UNKNOWN | 证明实际 helper 传递丢失；未执行Electron全链路 |
| Retry-After | hint=250ms/cap=1ms 时安排1ms重试，执行2次，实测共15ms | 证明本地重试早于提示；未对真实上游发请求或测量封禁 |

探针由 agent 执行并把结果写入 JSON，再读回核对。所有提供方、消息、密钥形状和错误均为合成输入。

### 现有门禁与测试

- harness context（tighten-host-api-contract-types）：exit 0。
- runtime docs-list：exit 0；不据此声称外部文档内容已验证。
- contract:check：exit 0。
- 6个聚焦单测文件：**29 passed / 0 failed / 0 skipped**，测试命令exit 0，已读回Vitest JSON结果。
  - tests/unit/host-invoke.test.ts（12）
  - tests/unit/r0-4-host-api-client-timeout.test.ts（2）
  - tests/unit/error-model.test.ts（4）
  - tests/unit/error-message.test.ts（4）
  - tests/unit/user-error.test.ts（4）
  - tests/unit/contract-check.test.ts（3）
- 仓库级 git diff --check：exit 2，命中本轮开始前已有的 electron/main/index.ts 并行修改中的5条尾随空白告警；未修改或清理这些行。新报告独立 diff 检查无告警（--no-index 因新旧内容不同返回1），并另外执行内容校验。
- 既有测试通过但反例成立，说明需要补相应回归测试；不能把绿色聚焦测试升级为错误治理验收通过。
- 后台状态、Problem 聚合、成本归因、端点预算的结论来自源码/相邻测试审计；这些新场景未在本轮运行。

未运行完整 Harness 行为验收、全量单测、Electron E2E、构建/安装包、跨平台或付费模型调用。未生成所谓真实运营事故、真人数据或真人 verdict。

## 5. 建议执行顺序和范围控制

1. 用#115校准事实与语义，不顺带开启全面重构。
2. 先#117（错误脱敏）与#119（重试下界），分别止损。
3. 接#116（失败信封/SSE）与#118（端到端结构化错误）。
4. 再#120（四语言可行动文案）与#121（未知状态可见）。
5. 最后复用既有资产推进#122/#123/#124；成本项消费#112的身份映射，新端点启用前完成对应预算。

每次推进一个明确边界的任务，不并行铺开大型实现。内部同包 Renderer/Main 不应无差别维护两个minor双栈；真正开放契约的版本/弃用策略先在#115厘清。“100 RPM”不自动成为默认值，不新建积分/退款、多租户额度、Webhook或观测平台。

## 6. 交付边界

本轮完成的是**问题确认、建单与方案沉淀**，不是修复完成。11条新 Issues 已回读确认 OPEN。后续需按各 Issue 的自动化标准实际生成、读取验收产物后再收口，不需要所有者提供真人操作或数据。
