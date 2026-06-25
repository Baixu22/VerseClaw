# ast-grep Useful Tests

证据源：`C:\Users\27933\Desktop\verseshell\ast-grep-main\crates\cli\tests\scan_test.rs`、`crates\cli\tests\verify_test.rs`、`crates\config\src\check_var.rs`。

## 值得移植的测试形态

- fixable rule 生成 diff。
- unfixable rule 只报告 match，不 apply。
- update-all 写文件并报告剩余 unfixable。
- inline rule 与配置文件 rule 行为一致。
- 多规则同一文件排序稳定。
- embedded language，例如 HTML 内脚本。
- unused suppression 检测。
- severity override。
- SARIF fixes 输出。
- valid/invalid fixture 验证规则。
- symlink test dir 处理。
- nested rewrite 和空行 rewrite range 顺序。

## ClawX 应新增 fixture

- TypeScript import rename。
- React prop rename。
- Electron IPC route rename。
- AST patch 与 symbol rename 冲突时的 verifier。
- match ranges 变化后的 resume 回退。
