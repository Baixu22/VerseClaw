---
lifecycleStatus: active
id: coding-jj-parity-evaluation
title: TF-0776 JJ 图语义与恢复对拍
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 2fa1e4e2c
intent: 对照固定 JJ 0.46.0 CLI oracle 验证 VG 的图改写、工作副本与恢复语义，绑定当前源码与二进制，不扩大宿主写权限。
touchedAreas:
  - harness/specs/tasks/coding-jj-parity-evaluation.md
  - scripts/coding-evaluation/jj.py
  - scripts/coding-evaluation/verify-jj.py
  - scripts/coding-evaluation/test_jj_evidence.py
  - resources/bin/win32-x64/vg.exe
  - resources/versegit/manifest.json
  - resources/versegit/patches/**
  - tests/unit/versegit-sidecar-delivery.test.ts
  - docs/modules/verse-tools.md
  - harness/specs/fixtures/coding-evaluation/TF-0776/**
expectedUserBehavior:
  - Git worktree、VG managed 和 Git/JJ colocated 形态有独立支持判定；拒绝形态以及 Git 选中路径位于嵌套 .git/.jj 标记下时终止，ambient Git selector 不影响 --root。
  - snapshot、change/commit/op 身份、rebase/squash/split/restore 及 Git ref 同步与同输入 oracle 的树和图结构一致。
  - 只读调用保留 dirty 内容、工作副本和 refs，旧操作、重复请求、并发及故障恢复有实际读回。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredTests:
  - cargo test -p vg-cli --test jj_workspace_lifecycle
  - cargo test -p vg-cli --test jj_file_family file_untrack_only_accepts_ignored_paths
  - cargo test -p vg-jj import_force_matcher_keeps_the_new_file_size_limit
  - cargo test -p vg-jj root_gitignore_survives_a_dot_git_pointer_file
  - cargo clippy -p vg-jj -p vg-cli --tests --all-targets -- -D warnings
  - python -X utf8 -B scripts/coding-evaluation/test_jj_evidence.py
  - python -X utf8 -B scripts/coding-evaluation/jj.py --output <new-absolute-directory> --oracle <pinned-jj.exe> --provider-source <clean-native-source-root>
  - python -X utf8 -B scripts/coding-evaluation/verify-jj.py <report.json> --candidate <frozen-ClawX-commit> --expected-report-digest <retained-canonical-report-digest> --negative-checks
  - pnpm harness validate --spec harness/specs/tasks/coding-jj-parity-evaluation.md
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - VG artifact、source/jj-lib 与独立 JJ oracle 版本及二进制摘要固定，实际命令和输出绑定当前候选。
  - 同输入树、ref 和 operation 历史结构的正常对照通过，随机 ID 不作跨仓相等断言。
  - snapshot、图改写、dirty/stale、并发、崩溃和部分恢复、旧操作及重复请求均有 oracle 和文件读回。
  - 不支持形态在写 JJ 状态前拒绝；只读不得隐式 snapshot/reconcile/改 ref；可见能力契约与支持范围一致。
  - 导入由隔离环境下的 Git tracked/non-ignored 文件集驱动，HEAD 继承树收窄到同一集合；沿用全局排除、core.excludesFile 路径插值、.git/info/exclude、逐目录 .gitignore 与 core.ignoreCase，大小写索引项绑定实际磁盘拼写，.jj/.vg 大小写别名不进入内容树；Git 选中 force-added 文件不被逐文件 ignore 丢弃，新文件上限仍在快照时独立执行。被忽略文件保留在磁盘且不进入 JJ 工作副本或 Git 对象库。
  - 超大或不可表示文件使导入明确失败而不发布不完整 @；首次失败清理本次新建的 .jj，修正输入后重试会完整捕获 dirty 内容。
  - 产物摘要、实际退出/清理、独立验证器的篡改反例与节点读回完成后自动收口。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/verse-tools.md
  note: 记录显式导入的来源修复与支持形态；根 README 保留模块入口。
---

TF-0758/E2。native standalone 写入仅运行在新建的一次性仓中；宿主继续使用原来的 bounded fact owner，M4 保持禁止。评测 actor 为 agent。
