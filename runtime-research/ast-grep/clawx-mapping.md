# ast-grep -> ClawX Mapping

Source Concept: structured rule config with pattern/fix  
ClawX Target: `AST Patch Planner`  
Reuse Level: adapt code  
Dependencies: ast-grep binary/library、language mapping、rule validator  
Risks: agent 生成的 pattern 过宽会误改；必须先 readonly scan。  
First Implementation Slice: 支持 TypeScript `pattern + fix` readonly scan，返回 matches 和 preview diff。  
Tests Needed: fixable/unfixable、过宽 pattern 阻断、多文件 diff、invalid rule。

Source Concept: variable validation across rule/fix/rewriters  
ClawX Target: patch safety gate  
Reuse Level: copy idea  
Dependencies: rule parser、variable checker  
Risks: 未定义变量会生成错误 patch 或空 patch。  
First Implementation Slice: apply 前校验 fix 中所有 metavariable 都由 pattern/constraints 绑定。  
Tests Needed: undefined variable、unused variable、transform variable、cyclic utility。

Source Concept: range-ordered rewrite application  
ClawX Target: batch patch engine  
Reuse Level: copy idea  
Dependencies: stable AST ranges、diff generator  
Risks: nested rewrite 顺序错会破坏文件。  
First Implementation Slice: 先只 preview diff；apply 时按非重叠 range 排序并拒绝冲突。  
Tests Needed: nested match、overlap conflict、empty-line rewrite、resume 后 range drift。
