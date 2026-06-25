# ast-grep Extraction

证据源：`C:\Users\27933\Desktop\verseshell\ast-grep-main\crates\config\src\rule_config.rs`、`crates\config\src\rule\mod.rs`、`crates\config\src\fixer.rs`、`crates\config\src\check_var.rs`、`crates\config\src\combined.rs`、`crates\cli\src\run.rs`、`crates\cli\src\scan.rs`。

## 1. Runtime Contract

ast-grep 的核心 contract 是“规则 + 语言 + pattern/fix -> matches/diffs”。`SerializableRuleConfig` 包含 rule core、fix、rewriters、id、language、message、note、severity、labels、files、ignores、url、metadata。

## 2. Context Assembly

ast-grep 不做 LLM context assembly。可借鉴的是结构化搜索前的范围约束：language、files、ignores、potential AST kinds、rule constraints。这可以让 ClawX AST Patch Planner 在动手前缩小候选文件和节点。

## 3. Tool Invocation

CLI `run.rs` 支持一次性 search/rewrite；`scan.rs` 支持按配置规则扫描多文件。输出可为 match、diff、SARIF 等。ClawX 可把它包装成 readonly scan 和 write patch 两类工具。

## 4. State Machine

隐含状态：

`parse_rule -> validate_variables -> build_matcher -> scan_ast -> collect_matches -> generate_diff -> apply_or_report`

`combined.rs` 还会按 potential AST kinds 分组规则、排序 fixable rules、处理 suppressions、分离 matches 与 diffs。

## 5. Checkpoint / Resume

ast-grep 本身不提供 long-running checkpoint。ClawX 可 checkpoint rule id、target files、match ranges、generated diff hash。resume 时重新 scan 并确认 match ranges/hash 是否仍一致，再 apply。

## 6. Verifier / Evidence

Verifier evidence 是 match 列表、diff、severity、rule id、fix 是否可用。`verify_test.rs` 使用 valid/invalid rule fixtures 验证规则本身，说明 patch planner 需要先验证 rule 再大规模应用。

## 7. Tests / Fixtures

`scan_test.rs` 覆盖 fixable/unfixable、update-all、inline rules、多规则、embedded HTML、unused suppressions、severity override、SARIF fixes。`verify_test.rs` 覆盖 valid/invalid、snapshot skip、filter、off rule include、symlink test dir。
