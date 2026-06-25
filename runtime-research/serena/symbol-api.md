# Serena Symbol API

## Core Data Model

证据源：`C:\Users\27933\Desktop\verseshell\serena-main\src\serena\symbol.py`。

- `LanguageServerSymbolLocation`: 相对路径 + line + column，是 Serena 内部定位 symbol 的主要标识。
- `PositionInFile`: line/col 到 LSP position 的转换层。
- `Symbol` 抽象：暴露 body start/end、body、name、相邻定义间距等。
- `LanguageServerSymbol`: 包装 LSP `UnifiedSymbolInformation`，提供 name、symbol kind、overload、relative path、body location、body line、`to_dict`。
- `NamePathMatcher`: 将用户输入的 name path 与 symbol tree 匹配。

## Retriever Capabilities

`LanguageServerSymbolRetriever` 包装 `LanguageServerManager`，能力包括：

- `find`
- `find_unique`
- `find_by_location`
- `find_referencing_symbols`
- `find_implementing_symbols`
- `find_declaration`
- diagnostics
- overview

`src\solidlsp\ls.py` 中可见 Serena 使用的 LSP request wrappers：definition、implementation、references、document symbols、full symbol tree、hover、signature help、workspace symbol、rename workspace edit、diagnostics。

## ClawX Symbol Tool Layer

推荐抽象：

```text
SymbolQuery:
  path?
  namePath?
  position?
  kind?
  depth
  includeBody

SymbolResult:
  symbolId
  namePath
  kind
  file
  range
  bodyRange
  signature
  children
  evidence
```

编辑层：

```text
SymbolEditPlan:
  targetSymbol
  operation: replaceBody | insertBefore | insertAfter | rename | safeDelete
  previewPatch
  expectedDiagnostics
```

ClawX 不应让 agent 默认用全文搜索完成所有代码理解；应优先调用 `SymbolOverview`、`FindSymbol`、`FindReferences`，只有 symbol API 不足时再 fallback 到 grep/read。
