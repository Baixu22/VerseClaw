# Agent Runtime Implementation Roadmap

这份路线图把 `runtime-research` 的研究结论转成长期引入计划。目标不是一次性重写 runtime，而是按可验证的能力切片，逐步形成 ClawX 自己的 `AgentMap`、`Runtime Context Provider`、`Symbol Tool Layer`、`Workflow Checkpoint Engine`、`Evidence Verifier`、`Trace Context Provider` 和 `AST Patch Planner`。

## Planning Principles

- 先做可复用 runtime core，再接 UI。
- 先做 readonly/context 能力，再做 mutating/patch 能力。
- 每个阶段都必须有 event/evidence/test，不能只靠 prompt 行为验证。
- 每个实现 PR 都要更新 `runtime-research/agent-runtime-index.md` 的状态和相关链接。
- 如果触及 renderer/Main/host-api/api-client/Gateway/OpenClaw runtime 路径，先按项目 AGENTS 规则补 harness task spec，并运行对应 harness context/validate。

## Phase 0: Runtime Surface Inventory

Purpose: 找到 ClawX 当前已有的上下文、工具、任务循环、事件、trace、测试入口，避免平行发明。

Deliverables:

- 当前 runtime entrypoints 清单。
- host-api/api-client/Gateway/OpenClaw runtime 边界图。
- 当前测试/harness 覆盖矩阵。
- 将本路线图拆成项目内 task specs 或 issue slices。

Read First:

- `runtime-research/agent-runtime-core-spec.md`
- `runtime-research/continue/providers.md`
- `runtime-research/openhands/runtime-events.md`

Exit Criteria:

- 有一张“当前实现 vs 目标模块”的差距表。
- 后续阶段能明确落在哪些 ClawX 目录，不需要靠猜。

## Phase 1: AgentMap MVP

Purpose: 先拿到上下文压缩核心能力，替代粗粒度文件阅读。

Scope:

- TypeScript/TSX symbol tag extraction。
- active files、mentioned files、mentioned identifiers、path components ranking。
- token-budgeted render。
- context evidence: included files/symbols/token estimate。

Out of Scope:

- 复杂多语言全覆盖。
- UI 大改。
- agent 自动 patch。

Read First:

- `runtime-research/aider/algorithms.md`
- `runtime-research/aider/contracts.md`
- `runtime-research/aider/useful-tests.md`
- `runtime-research/aider/clawx-mapping.md`

Acceptance Tests:

- active file reference 提升相关 definition。
- mentioned identifier 提升相关 symbol。
- 已在 prompt 中的文件不重复进入 AgentMap。
- 不同 token budget 下输出单调收缩。
- sample fixture 快照稳定。

## Phase 2: Symbol Tool Layer MVP

Purpose: 把 Agent 从文件级操作升级到符号级操作。

Scope:

- `getSymbolsOverview`
- `findSymbol`
- `findReferences`
- diagnostics wrapper
- symbol checkpoint: file + namePath + range

Out of Scope:

- 全语言 rename。
- 自动 safe delete。
- 自研语言分析。

Read First:

- `runtime-research/serena/symbol-api.md`
- `runtime-research/serena/useful-tests.md`
- `runtime-research/serena/clawx-mapping.md`

Acceptance Tests:

- 跨文件 references。
- 同名/嵌套 symbol disambiguation。
- language server 不可用时结构化错误降级。
- checkpoint 后文件轻微变化时能重新定位或明确 drift。

## Phase 3: Provider and Tool Registries

Purpose: 把上下文来源和工具调用统一到可注册、可审计、可策略控制的协议里。

Scope:

- `RuntimeContextProviderRegistry`
- `ToolProviderRegistry`
- normalized `ToolCallRequest` / `ToolCallResult`
- permission policy: allow / ask / deny
- MCP/built-in tool result normalization

Out of Scope:

- 复制 Continue UI。
- renderer 直接新增 Gateway HTTP 调用。

Read First:

- `runtime-research/continue/providers.md`
- `runtime-research/continue/tool-provider.md`
- `runtime-research/continue/slash-command.md`
- `runtime-research/continue/useful-tests.md`

Acceptance Tests:

- 默认 provider 加载。
- unknown provider 不阻断其它 provider。
- tool success/error/denied/cancelled 全部结构化返回。
- MCP unsupported content 转成 error context item。
- tool exception 不穿透 task loop。

## Phase 4: Event Log, Checkpoint, Resume

Purpose: 让任务可恢复、可回放、可审计。

Scope:

- append-only `RuntimeTaskEvent` log。
- state reducer。
- checkpoint serializer。
- idempotency key for tool calls。
- continue-as-new for long histories。

Out of Scope:

- 引入 Temporal 服务。
- 重新执行有副作用的历史 tool call。

Read First:

- `runtime-research/temporal/workflow-semantics.md`
- `runtime-research/temporal/useful-tests.md`
- `runtime-research/openhands/runtime-events.md`
- `runtime-research/openhands/useful-tests.md`

Acceptance Tests:

- event log 恢复 created/planning/running/waiting/verifying/completed。
- resume 后不会重复执行已完成 side-effect tool call。
- 缺失 tool result 时回到 waiting/verifying，而不是假完成。
- long run 压缩后保留 open obligations 和 evidence refs。

## Phase 5: Evidence Verifier

Purpose: 让 runtime 的完成判断从“模型说完成”升级为“证据证明完成”。

Scope:

- file evidence: path/hash/diff/symbol range。
- test evidence: command/exit/output summary。
- tool evidence: tool call id/status/data。
- trace evidence: trace/span/status/events。
- verifier decision: completed / failed / blocked / cancelled。

Out of Scope:

- 所有任务都强制跑全量测试。
- 用字符串错误分类替代结构化错误 taxonomy。

Read First:

- `runtime-research/agent-runtime-core-spec.md`
- `runtime-research/temporal/extraction.md`
- `runtime-research/openhands/extraction.md`

Acceptance Tests:

- 有 patch 但无测试/诊断证据时不能 completed。
- 未处理 tool error 阻止 completed。
- blocked 必须有明确 external dependency。
- verifier 输出可追溯到 evidence refs。

## Phase 6: Trace Context Provider

Purpose: 让 Agent 能理解 runtime/tool/test/线上行为，而不是只看聊天和文件。

Scope:

- span-like task/tool/test events。
- trace id/span id/parent id/link。
- query by task/tool/file/symbol/status/time range。
- trace summary with token budget。
- source refs: file/line/symbol/diff hash。

Out of Scope:

- 完整 observability 平台。
- 无预算 trace dump。

Read First:

- `runtime-research/opentelemetry/trace-model.md`
- `runtime-research/opentelemetry/query-and-source-mapping.md`
- `runtime-research/opentelemetry/useful-tests.md`

Acceptance Tests:

- parent/child spans 可查询。
- error span 排序优先。
- resume span link 可查询。
- untrusted external traceparent 被重新根化或标记。
- summary 在 token budget 内保留关键 evidence。

## Phase 7: Runtime Memory Provider

Purpose: 把长期任务事实建成有时间关系和证据来源的知识层，而不是存聊天记录。

Scope:

- task event / tool result / test output as episodic records。
- fact edges with valid_at / invalid_at。
- query current valid facts。
- source episode/evidence refs。

Out of Scope:

- 一开始就接复杂图数据库。
- 无 verifier 的 LLM 事实抽取自动入库。

Read First:

- `runtime-research/graphiti/temporal-knowledge-graph.md`
- `runtime-research/graphiti/useful-tests.md`
- `runtime-research/graphiti/clawx-mapping.md`

Acceptance Tests:

- 需求变更后旧 fact invalidated，新 fact valid。
- 当前事实查询不返回已失效 fact。
- episode idempotency。
- fact 可追溯到 source event/evidence。

## Phase 8: AST Patch Planner

Purpose: 在已有 AgentMap、Symbol Tool、Verifier 基础上引入结构化 patch planning。

Scope:

- TypeScript pattern/fix readonly scan。
- rule validation。
- preview diff。
- range drift detection on resume。
- apply only after verifier-ready evidence plan。

Out of Scope:

- 复杂 intent compiler。
- agent 生成规则后直接 apply。

Read First:

- `runtime-research/ast-grep/rule-structure.md`
- `runtime-research/ast-grep/patch-flow.md`
- `runtime-research/ast-grep/useful-tests.md`

Acceptance Tests:

- invalid rule 被拒绝。
- overbroad pattern 被阻断或需要人工确认。
- overlapping ranges 拒绝 apply。
- resume 后 match ranges 变化会回到 review。

## Ongoing Operating Model

每个实施切片都按同一套节奏推进：

1. 从 `runtime-research/agent-runtime-index.md` 找入口。
2. 读取对应项目 `clawx-mapping.md` 和 `useful-tests.md`。
3. 在 ClawX 当前代码中确认已有实现边界。
4. 如需 spec/harness，先补 spec，再实现。
5. 实现最小可验证 slice。
6. 更新测试、README 多语言文档或 harness 规则。
7. 更新 `agent-runtime-index.md` 状态，记录新增入口、测试命令、下一步。

## Risk Controls

- Do not introduce a second source of truth outside `runtime-research` and `harness/specs`.
- Do not let renderer bypass host-api/api-client/Gateway proxy policies.
- Do not mark a runtime task completed without evidence refs.
- Do not persist unverified long-term memory as fact.
- Do not retry mutating tools without idempotency.
- Do not apply AST rewrites without readonly scan and diff preview.
