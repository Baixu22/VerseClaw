# Runtime Research

## Agent Entry Points

- `agent-runtime-index.md`: 后续开发 agent 的第一入口，按任务类型路由到对应研究和实现状态。
- `implementation-roadmap.md`: 长期引入路线图，按阶段定义 scope、验收测试和风险控制。
- `migration-execution-plan.md`: 面向替换现有不成熟方案的迁移执行计划，定义兼容、影子验证、切流和旧路径退场。
- `handoffs/phase-1-runtime-surface-inventory/`: 第一轮多窗口并行调研 handoff 包，含提示词、lane 分工、提交模板和综合模板。
- `agent-runtime-core-spec.md`: 汇总后的 ClawX Agent Runtime Core Spec。
- `completion-audit.md`: 本轮研究沉淀的完成审计。

本目录沉淀 `C:\Users\27933\Desktop\verseshell` 下已克隆项目的 Runtime 设计证据，暂不纳入 `verseshell` 和 `codegraph-main`，也不单独研究 LSP 项目；LSP 只作为 Serena 符号层的实现依赖被记录。

## 证据边界

- Aider、Continue.dev、Serena、ast-grep、Graphiti、Temporal Python SDK、OpenTelemetry docs、OpenHands app-server 快照均来自本机源码或文档。
- OpenTelemetry 目录是 `opentelemetry.io` 文档站，不是 SDK 源码；这里只提取 trace 数据模型和 context propagation 概念。
- Temporal 目录是 Python SDK，不是 Temporal 服务端；这里只提取 SDK 暴露出的 workflow、retry、history replay、continue-as-new 等语义。
- OpenHands 本地快照主要包含 `app_server`、conversation、event、callback、resolver 等代码，未发现完整 `openhands.sdk` 源码；这里只提取会话/事件服务层，不伪造成完整 Planner/Executor runtime。

## 项目目录

- `aider/`: RepoMap、符号摘要、文件排序、token budget。
- `serena/`: 符号级读写、引用、实现、诊断、重命名包装。
- `continue/`: Context Provider、Tool Provider、Slash Command、MCP tool 调用协议。
- `opentelemetry/`: trace/span/context propagation、查询键和源码映射思路。
- `temporal/`: workflow 状态、retry、checkpoint/resume/replay 语义。
- `ast-grep/`: 规则结构、pattern/fix、批量 patch 流程。
- `graphiti/`: episode 到时序知识图谱的建模、搜索和去重。
- `openhands/`: app-server 侧会话启动任务、事件存储、回调、终态证据。
- `agent-runtime-core-spec.md`: 面向 ClawX 的统一 Agent Runtime Core Spec。

## 固定提取模板

每个项目至少覆盖七类内容：Runtime Contract、Context Assembly、Tool Invocation、State Machine、Checkpoint / Resume、Verifier / Evidence、Tests / Fixtures。若某项目源码中没有对应能力，文档会明确写为“未在本地证据中发现”，不做推测。
