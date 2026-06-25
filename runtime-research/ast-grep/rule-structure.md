# ast-grep Rule Structure

## Rule Config

证据源：`C:\Users\27933\Desktop\verseshell\ast-grep-main\crates\config\src\rule_config.rs`。

`SerializableRuleConfig` 将 rule core flatten 到顶层，并附加：

- `fix`
- `rewriters`
- `id`
- `language`
- `message`
- `note`
- `severity`
- `labels`
- `files`
- `ignores`
- `url`
- `metadata`

`RuleConfig::try_from` 会构建 matcher、要求 potential kinds、解析 fixer transform、检查 fix 中变量。

## Rule Kinds

证据源：`crates\config\src\rule\mod.rs`。

规则类别：

- atomic: Pattern、Kind、Regex、NthChild、Range
- relational: Inside、Has、Precedes、Follows
- composite: All、Any、Not、Matches

relational rule 在 atomic/composite 后反序列化，因为要先决定当前 target node，再判断相对关系。

## Variable Checks

证据源：`crates\config\src\check_var.rs`。

变量检查覆盖 rules、constraints、transform、fix、rewriters，测试包含未定义变量、utils、循环依赖、参数化 globals。ClawX 的 AST Patch Planner 如果让 agent 生成规则，必须先做变量/约束验证，不能直接 apply。
