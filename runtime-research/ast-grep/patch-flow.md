# ast-grep Patch Flow

## Scan and Diff

证据源：`C:\Users\27933\Desktop\verseshell\ast-grep-main\crates\config\src\combined.rs`、`crates\cli\src\run.rs`、`crates\cli\src\print\interactive_print.rs`。

批量 patch 的核心步骤：

```text
load rules
  -> group by potential AST kinds
  -> scan AST
  -> separate matches and diffs
  -> sort/apply fixable rewrites
  -> report unfixable matches
```

`interactive_print.rs` 中 apply rewrite 会按 range 处理，并有 nested/empty-line rewrite 测试。这说明 ClawX patch planner 必须维护 range ordering，不能把多个 AST rewrite 当成普通字符串替换。

## ClawX Patch Planner

建议 flow：

```text
Intent
  -> candidate files from AgentMap/Symbol layer
  -> draft ast-grep rule
  -> verify rule with valid/invalid fixtures
  -> scan readonly
  -> review match evidence
  -> generate diff
  -> apply patch
  -> run formatter/tests/diagnostics
```

首期不要做复杂 intent compiler。先支持人/agent 明确给 pattern/fix，或由 ClawX 内置少量高频规则模板。

## Checkpoint

每次 patch plan 存：

- rule config hash
- target file list
- match count
- match ranges
- diff hash
- applied file hashes

resume 时重新 scan；如果 match count/ranges 不一致，必须回到 review，而不是继续 apply 旧 diff。
