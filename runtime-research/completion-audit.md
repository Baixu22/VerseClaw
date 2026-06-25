# Runtime Research Completion Audit

审计时间：2026-06-24。审计对象：`C:\Users\27933\Desktop\clawx\ClawX\runtime-research`。

## Scope

用户要求从 `C:\Users\27933\Desktop\verseshell` 的成熟 runtime/agent 项目中提取信息沉淀，暂不考虑 `verseshell` 与 `codegraph-main`，并保证真实、避免伪造。当前源码目录包括：

- `aider-main`
- `ast-grep-main`
- `continue-main`
- `graphiti-main`
- `OpenHands-main`
- `opentelemetry.io-main`
- `serena-main`
- `Temporal_Python`

`verseshell` 与 `codegraph-main` 未纳入沉淀；独立 LSP 未单独建包，只作为 Serena 符号层证据记录。

## Requirement Audit

| Requirement | Evidence | Status |
|---|---|---|
| 每个项目提取 7 类内容 | 8 个项目的 `extraction.md` 均包含 Runtime Contract、Context Assembly、Tool Invocation、State Machine、Checkpoint / Resume、Verifier / Evidence、Tests / Fixtures 七个标题。 | Complete |
| Continue.dev 重点提取 Provider/Tool/Slash Command | `continue/providers.md`、`continue/tool-provider.md`、`continue/slash-command.md`、`continue/clawx-mapping.md`。 | Complete |
| Aider 重点提取 RepoMap/token budget | `aider/algorithms.md`、`aider/contracts.md`、`aider/useful-tests.md`、`aider/clawx-mapping.md`。 | Complete |
| Serena 重点提取符号级操作 | `serena/symbol-api.md`、`serena/useful-tests.md`、`serena/clawx-mapping.md`。 | Complete |
| OpenTelemetry 重点提取 trace/span/query/source mapping | `opentelemetry/trace-model.md`、`opentelemetry/query-and-source-mapping.md`、`opentelemetry/useful-tests.md`。 | Complete |
| Temporal 重点提取 workflow/retry/resume | `temporal/workflow-semantics.md`、`temporal/useful-tests.md`、`temporal/clawx-mapping.md`。 | Complete |
| ast-grep 重点提取规则和 patch flow | `ast-grep/rule-structure.md`、`ast-grep/patch-flow.md`、`ast-grep/useful-tests.md`、`ast-grep/clawx-mapping.md`。 | Complete |
| Graphiti 重点提取事件到时序知识图谱 | `graphiti/temporal-knowledge-graph.md`、`graphiti/useful-tests.md`、`graphiti/clawx-mapping.md`。 | Complete |
| OpenHands 保持真实边界 | `openhands/extraction.md` 明确本地快照未发现完整 SDK/runtime 源码，只提取 app-server conversation/event/callback 层；本地搜索仅发现 frontend planner tab。 | Complete |
| 每项目 `clawx-mapping.md` 使用固定字段 | 8 个 mapping 文件均包含 21 个字段行，即 3 组 `Source Concept` / `ClawX Target` / `Reuse Level` / `Dependencies` / `Risks` / `First Implementation Slice` / `Tests Needed`。 | Complete |
| 汇总成 Agent Runtime Core Spec | `agent-runtime-core-spec.md` 定义 Runtime Contract、Context Assembly、Tool Invocation Protocol、State Machine、Checkpoint / Resume、Verifier / Evidence、Tests / Fixtures 和实施顺序。 | Complete |
| 避免伪造 | `README.md` 和各项目文档记录证据边界；marker scan 无命中。 | Complete |

## Verification Commands

```powershell
rtk powershell -NoProfile -Command "(Get-ChildItem -Recurse -LiteralPath 'runtime-research' -Filter '*.md').Count"
rtk rg -n "<marker pattern>" runtime-research
rtk rg -c "^## [1-7]\. (Runtime Contract|Context Assembly|Tool Invocation|State Machine|Checkpoint / Resume|Verifier / Evidence|Tests / Fixtures)$" runtime-research -g extraction.md
rtk rg -c "^Source Concept:|^ClawX Target:|^Reuse Level:|^Dependencies:|^Risks:|^First Implementation Slice:|^Tests Needed:" runtime-research -g clawx-mapping.md
```

Observed results:

- Markdown file count before this audit file: 39.
- Placeholder scan: no matches.
- Each project `extraction.md`: 7 headings.
- Each project `clawx-mapping.md`: 21 fixed field lines.
