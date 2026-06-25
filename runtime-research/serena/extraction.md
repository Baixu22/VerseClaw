# Serena Extraction

证据源：`C:\Users\27933\Desktop\verseshell\serena-main\src\serena\symbol.py`、`src\serena\tools\symbol_tools.py`、`src\solidlsp\ls.py`。按用户要求，不单独提取 LSP 项目；这里只记录 Serena 对 LSP 的包装方式。

## 1. Runtime Contract

Serena 将代码操作建模为 symbol-level tools。输入通常是相对路径、name path、position、depth、kind filter、include_body/include_info 等；输出是 JSON 或文本化的 symbol 信息、引用列表、诊断、编辑结果。

关键 contract 是 `LanguageServerSymbolLocation(relative_path, line, column)` 和 symbol name path。name path 支持简单名、后缀路径、绝对路径 `/Class/method`、overload index `[i]`、最后组件 substring matching。

## 2. Context Assembly

Serena 的上下文不是“整文件”，而是按符号树装配：

- `GetSymbolsOverviewTool`: 获取文件顶层符号概览，可按 kind 分组、按 depth 展开，过长时返回缩短版。
- `FindSymbolTool`: 按 name path 全局/局部查找，可控制 depth、是否包含 body、是否包含 metadata。
- `FindReferencingSymbolsTool`: 查引用并附短 snippet，按文件/kind 分组。

这正好补足 Aider RepoMap：Aider 负责“候选排序和压缩”，Serena 负责“精确定位和符号级读取”。

## 3. Tool Invocation

`symbol_tools.py` 暴露的工具包括 overview、find symbol、find references、find implementations、find declaration、diagnostics，以及编辑类工具 `ReplaceSymbolBodyTool`、`InsertAfterSymbolTool`、`InsertBeforeSymbolTool`、`RenameSymbolTool`、`SafeDeleteSymbol`。

工具执行依赖 `LanguageServerSymbolRetriever`，由它包装 LSP request，包括 document symbols、workspace symbols、references、implementation、declaration、hover、signature、rename edit、diagnostics。

## 4. State Machine

源码没有中心任务状态机，但符号工具的隐含状态为：

`resolve_project -> ensure_language_server -> locate_symbol -> validate_unique_or_many -> read_or_edit -> return_structured_result`

编辑类工具还应在 ClawX 侧增加：

`preview_edit -> apply_edit -> diagnostics -> evidence`

## 5. Checkpoint / Resume

Serena 的 symbol location、relative path、name path 可以作为可恢复 checkpoint。语言服务器状态本身不可作为可靠 checkpoint；恢复时应重新启动/连接 LS，然后用文件路径 + name path + position 重新定位。

## 6. Verifier / Evidence

Serena 的 evidence 是符号位置、引用位置、diagnostics 和 workspace edit。对 ClawX 来说，符号编辑完成不能只看 patch 成功，还应复查：

- 目标 symbol 仍可定位。
- 引用数变化符合预期。
- diagnostics 没有新增严重错误。
- rename workspace edit 覆盖跨文件引用。

## 7. Tests / Fixtures

本地 `test\solidlsp\...` 覆盖多语言 definition、references、hover、diagnostics、rename、cross-file references。`test\serena\test_hooks.py` 还体现了“当用户反复 grep/read 而不用 symbol 工具时提醒”的行为约束，可作为 ClawX 防止低效上下文搜索的启发。
