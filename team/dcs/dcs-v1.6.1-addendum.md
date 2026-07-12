# DCS v1.6.1 规范增补

**性质**：v1.6 正式增补，与 `dcs-v1.6-spec.md` 同级权威。本文只补充
v1.6 已收敛规范的缺口，不构成平行规范；发生冲突时必须停止实施并先修订增补。

**日期**：2026-07-12

**来源**：`DCS-V1.6.1-ADDENDUM-DRAFT.md`、DCS Runtime 组件生效性审计、
P0 workspace-binding 决策书，以及 Stage 1 已审定实现事实。

---

## 增补 1：第三个 feature flag 正式化与命名统一

### 代码事实

- v1.6 第一章规定的 `DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS` 只有两个内部
  snake 键：`compass`、`role_memory`。
- Stage 1 使用第三键 `runtime.contextBlock.working_memory.enabled`
  （`context-engine/assembler.ts:25-29` 的内部 snake 形式）。
- config schema 使用
  `runtime.contextBlock["working-memory"].enabled`
  （`config/runtime-context-block-working-memory.test.ts` 的 canonical kebab
  形式）。
- v1.6 [P1] 规定 flag 名为
  `runtime.contextBlock.{source_system}.enabled`，其中 `source_system`
  使用 `role-memory`、`working-memory` 等枚举原值。

### 正式条文

**`[MUST]`** `DEFAULT_CONTEXT_BLOCK_FEATURE_FLAGS` 正式包含三个键：
`compass`、`role_memory`、`working_memory`；后续 source system 接入时按同一
规则扩展。

**`[MUST]`** canonical flag 名以 [P1] 为准：
`runtime.contextBlock.{source_system}.enabled`，其中 `{source_system}` 使用
`SourceSystem` 枚举原值（kebab，如 `working-memory`、`role-memory`）。
config schema、labels、help 和文档一律使用 canonical 形式。

**`[MUST]`** Assembler 内部键（snake）与 canonical 键（kebab）之间必须存在
唯一且有单元测试覆盖的映射函数；禁止在调用点手写字符串换算。

---

## 增补 2：working-memory 注入的临时投影契约

### 代码事实

- 注入挂在 `agents/embedded-agent-runner/extensions.ts` 的
  `agent.on("context")`，即 agent-core `transformContext` 的 emitHook 目标
  （`packages/agent-core/src/harness/agent-harness.ts:507`）；每次 LLM 调用在
  `[...messages]` 副本上执行。
- v1.6 第九章阶段 1 只规定 working_memory Block 在 pre-LLM 时注入
  Assembler，未明确投影语义与去重。

### 正式条文

**`[MUST]`** working-memory 注入只允许通过每次 LLM 调用的
`transformContext` 路径产生临时投影：不写 transcript、不写 session state、
不随消息持久化。

**`[MUST]`** 任意一次 LLM 调用的最终 context 中，`## Recent Actions` 标题
恰好出现 0 或 1 次；连续多次 pre-LLM 调用不得累积。测试必须同时覆盖
per-call hook 注入点与 Context Engine 组装点
（`embedded-agent-runner/run/attempt.ts:3089`）同时开启的场景。

**`[MUST]`** 阶段 0 identity pass-through 条款收窄为：compass 与
role_memory 两个 flag 为 false 时 `output === existing_output`；working_memory
flag 开启时允许 output 为追加单条注入消息的新数组，其余元素保持原引用。

---

## 增补 3：诚实报告要求

**`[MUST]`** Stage 1 完成报告必须包含以下明确结论：

> DCS working-memory infrastructure ready; production producer coverage = 0

runtime 中尚无生产者产出 `details.working_memory` 时，测试中的合成 envelope
不得表述为真实 coding 增益。

**`[MUST]`** Runtime build 修复属于门禁责任，其变绿证据与 DCS 功能证据必须
在报告中分开列示；build 变绿不计为 working-memory 正收益。

**`[SHOULD]`** 首个真实 producer（edit/write/apply_patch）与 workspace
authority 由后续
`harness/specs/tasks/coding-runtime-workspace-dcs-producer-vertical-slice.md`
交付；其 preflight 路径图与 workspace-binding 决策分别见
`DCS-P0-PREFLIGHT-PATHMAP.md` 与
`DCS-P0-WORKSPACE-BINDING-DECISION.md`。

---

## 增补 4：session 分类谓词的 mainKey 配置感知

### 代码事实

- `sessions/session-key-utils.ts:270` 的共享谓词 `isMainSessionKey`
  硬编码字面量 `"main"`，不感知 `config.session.mainKey`。
- runtime 至少有四处经 `normalizeMainKey(cfg.session.mainKey)` 实现的配置感知
  私有判定：
  - `agents/session-agent-binding.ts:42-43`
  - `auto-reply/reply/runtime-policy-session-key.ts:67-85`
  - `acp/control-plane/manager.utils.ts:80-81`
  - `agents/subagent-requester-store-key.ts:32-33`
- `context-engine/assembler.ts:56` 的 `selectHandlers` 使用
  `isMainSessionKey(request.session_id)` 决定 `["compass"]` 分支。

### 正式条文

**`[MUST]`** `session-key-utils` 的 main-session 谓词必须感知
`config.session.mainKey`：新增 config-aware 变体，或让现有谓词接受默认值为
`"main"` 的可选 `mainKey` 参数以保持向后兼容；`selectHandlers` / Assembler
必须走配置感知路径。

**`[MUST]`** 上述四处 runtime 私有判定必须迁移到共享谓词以消除平行实现
（ANTI-3）；迁移不得改变 `runtime-policy-session-key.ts` 的别名矩阵语义，
agent-scoped `main` 与自定义 mainKey 双份别名必须由共享谓词显式覆盖。

**`[MUST]`** Assembler session 分类测试必须包含自定义 `mainKey` 用例：
配置 `session.mainKey = "primary"` 时，key 为 `primary` 的 session 必须分类出
`["compass"]`，`main` 字面量行为按别名矩阵约定显式断言。

**`[SHOULD]`** 在 Stage 1 完成后实施本条，避免与 Stage 0/1 共享文件并发冲突。

---

## 增补 5：注入通道处置决策

### 代码事实

- `context-engine/provider-registry.ts:530` 的
  `createContextProviderRegistryPilot` /
  `runContextProviderRegistryPilot` 没有生产调用方。
- `context-engine/chat-turn-memory-injection.ts:43` 的 pilot 默认关闭，并具有
  flag-off pass-through 行为。

### 正式条文

**`[MUST]`** provider-registry pilot 标记为 deprecated，并登记为待删除项；
删除由 T1 执行，在删除前必须先证明零生产引用。若删除会牵连活路径，停止删除并
降级为仅保留 deprecated 标记。

**`[MUST]`** chat-turn-memory-injection pilot 保留为 DCS 阶段 4 的 A/B
对照基线；阶段 4 完成等价性、回退与全门禁验收后废弃。

**`[MUST]`** DCS 阶段 4 不得新建第三条 role-memory 注入通道。

---

## 增补 6：双注入预算条款

### 代码事实

- CVK `systemPromptAddition` 在
  `agents/embedded-agent-runner/run/attempt.ts:3124` 注入。
- DCS `transformContext` 在
  `packages/agent-core/src/harness/agent-harness.ts:507` 注入。
- 两者是独立注入点，当前互不感知。

### 正式条文

**`[MUST]`** observability 必须分别记录 CVK `systemPromptAddition` 与 DCS
`transformContext` 每次调用的实际字符数。

**`[MUST]`** DCS 阶段 4 开工前必须声明两个注入点合计的字符上限；具体数值由
阶段 4 manifest 收敛，本增补只建立“必须有上限声明”的义务。

**`[MUST]`** 阶段 4 前不得引入跨两个注入点的动态裁剪。

---

## v1.6 → v1.6.1 变更摘要

| 问题 | v1.6.1 处理 |
|------|-------------|
| 第三 flag 已落地但规范只有两键 | DEFAULT 常量正式化为三键 |
| flag 命名 kebab/snake 混用 | canonical 采用 [P1] kebab 形式；内部映射唯一且有测试 |
| 阶段 1 注入语义未定义投影/去重 | transformContext 临时投影、exactly-once 与收窄 identity 条款 |
| 完成报告可能混淆基础设施与真实增益 | producer coverage = 0 诚实声明；build 证据分列 |
| mainKey 自定义值导致 DCS session 分类失真 | config-aware 共享谓词与四处私有判定收编 |
| 两条休眠 role-memory pilot 可能演化为第三套通道 | provider-registry 待删；chat-turn pilot 仅作阶段 4 A/B 基线 |
| CVK 与 DCS 双注入无联合预算 | 分别记录字符数；阶段 4 前声明合计上限 |
