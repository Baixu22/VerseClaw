# Serena -> ClawX Mapping

Source Concept: name path based symbol lookup  
ClawX Target: `Symbol Tool Layer`  
Reuse Level: adapt code  
Dependencies: LSP manager、workspace path normalization、symbol cache  
Risks: name path 非全局唯一；overload 和 substring matching 可能误命中。  
First Implementation Slice: TypeScript/TSX `findSymbol` + `getSymbolsOverview`，返回 path/range/kind/bodyRange。  
Tests Needed: 同名函数、嵌套类方法、substring 匹配、跨文件 symbol。

Source Concept: references / implementation / declaration wrappers  
ClawX Target: Symbol-aware context expansion  
Reuse Level: copy idea  
Dependencies: LSP request wrappers  
Risks: 不同语言服务器返回质量不一致；未打开文件索引可能不完整。  
First Implementation Slice: `findReferences(symbolId)`，将引用按文件分组并带 snippet。  
Tests Needed: 跨文件引用、未打开文件、空引用、LS 错误降级。

Source Concept: symbol edit tools  
ClawX Target: Structured edit planner  
Reuse Level: rewrite  
Dependencies: patch engine、diagnostics verifier、workspace edit applier  
Risks: 直接 replace body 可能破坏格式或 import；safe delete 需要引用验证。  
First Implementation Slice: `previewReplaceSymbolBody` + `applySymbolEdit` + diagnostics evidence。  
Tests Needed: 编辑前预览、编辑后 symbol 仍可定位、诊断回归、引用数检查。
