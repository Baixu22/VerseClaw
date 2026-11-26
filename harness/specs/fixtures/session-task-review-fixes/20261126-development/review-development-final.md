# TF-0950 开发阶段独立验收

- candidate: cf2b04a1747b3912069edeb5354e2ea12ce4b6b2
- diffBase: 4085cd46b9a604e0617e91feff33f6ee8c24d7f0
- driven_by: agent
- actor: tf0950_r5_acceptance
- code_review: pass
- development_complete: pass
- heavy_acceptance: deferred_by_user

结论：当前整合候选的代码与规范开发完成，静态复核未发现七项修复或已定位 bootstrap/restore 根因的剩余可行动代码缺口。重型验收按用户要求延期；此结论不表示完整验收通过。

## 当前候选与整合

- 工作区 HEAD 为 cf2b04a1747b3912069edeb5354e2ea12ce4b6b2，工作区干净；相对 diffBase 的 git diff --check 通过。
- commit 081f0f708 将 origin/main 的 4085cd46b 合入 r7 候选 e6eb6b752；README.md、README.zh-CN.md、README.ja-JP.md、README.ru-RU.md 同时保留设置外观与持久任务说明。后续 cf2b04a17 将 task spec 的 diffBase 更新为完整 main SHA，并纳入 bootstrap、scope-completion、history-retry 回归到 requiredTests。
- r7 之后，任务生产代码未改动；openclaw_runtime/src/agents/workspace.ts、openclaw_runtime/src/agents/execution-task-barrier.ts 和 tests/unit/session-task-workspace-bootstrap.test.ts 与 r7 候选逐字节相同。
- r5 NO_GO 回执仍保留于 D:/tmp/session-task-relay-20261126-01a213b9/review-final-code-r5.md；r6/r7 回执记录 P1 修复和 main semantic-state 整合审查通过。

## Bootstrap 修复及绑定证据

- 原始根因诊断 D:/tmp/session-task-relay-20261126-01a213b9/restore-root-cause.json 记录：archive 成功；restore 收到 runtime_committed 新 generation receipt，但 coordinator 为 invalid/environment-generation-changed，taskRestoreEventCount 为 0，gitCreated 为 true。
- 修复在 workspace.ts 的 ensureGitRepo 中：已存在 Task domain DB 时不运行 git init；域检查及有界初始化置于执行域屏障内。execution-task-barrier.ts 在 realpath 前递归建立 state 父目录。
- 实际报告路径为 `D:/tmp/session-task-relay-20261126-01a213b9/bootstrap1/bootstrap/report.json`；其 `planSha256` 为 `311a0934d3dc3e6fe1e446ea958b42f86086a4359810364d81f46ab685d414e5`，与 `D:/tmp/session-task-relay-20261126-01a213b9/plan-bootstrap1.json` 的 SHA256 完全匹配。该计划和报告均绑定候选 e6eb6b7528924d05f2a537be2730c05e3df04270、tree 997119013921e9f7d160f09fc27b6ac6e292397d；执行退出码 0。unit-results.json 记录 2/2 tests passed。plan-r7.json 也列有相同源文件哈希，可作为同源参考。
- 日志 SHA256 已核对：bootstrap.stdout.log e9f8d6d749a4abc974bc4bc1f1af76c4f21dc794b8c919d89dee04dbfbc52e30；bootstrap.stderr.log e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855。unit-results.json SHA256 为 cd7d309852e0a11a21b0e3b5c6936d25695aebcdf04c3bf49078849c7ad72e1e；report.json SHA256 为 b9e9482ab78df22220b5d0df79dbab9c55de89e9832f95470c00326a1cf31e3c。
- 当前 bootstrap 三份源文件 SHA256 与 plan-r7.json 绑定值一致：workspace.ts df7f55be5296039f84ba9dc85f8163dff7aa5dac76e26be801d8b4075eba165b；execution-task-barrier.ts 297f1d10c747e77832debc7df4d68ad87caee9ba63907297b9df472d7c4d7678；session-task-workspace-bootstrap.test.ts 872fb55850339580f6a9509079c422c4cf1b781a7177585b6e99e49e3590f31e。因此 2/2 bootstrap 结果对当前三个文件仍适用。

## 七项修复复核与门禁状态

- 取消与运行/效果结清、归档恢复及 generation 迁移、首次 bootstrap 域保持、暂停任务恢复凭证、只读/副作用工具准入与 `shared/task-system/runtime.ts` / `store.ts` 按任务点查（避免读取全量 Task Ledger）、迟到响应与草稿作用域、handoff 回执后的草稿清理均保留在当前任务 spec acceptance 与对应 runtime/UI 测试范围中。r7 语义状态规范化与 restore lifecycle 兼容性已在 review-final-code-r7.md 核对；本次 merge 和 spec 更新未改动这些生产代码路径。
- task spec 的 requiredTests 当前包含新增的 session-task-workspace-bootstrap、session-task-scope-completion、chat-store-history-retry 单测及类型、契约、通信、Electron、Harness 检查。
- 主代理提供的 development-light 回执直接绑定当前候选 cf2b04a1747b3912069edeb5354e2ea12ce4b6b2、tree 9fbf77d071251f3709db54a3a61fd839fdaa94fd、base 4085cd46b9a604e0617e91feff33f6ee8c24d7f0；report status passed，五项命令均 exit 0，sourceAfter 均为该 commit/tree 且 dirty=false。report.json SHA256 为 56c67e8553978fa3dc8b53c57ac2f9f100b08861e101fdf4814d7ed3e7a140a3；plan-development-light.json SHA256 为 ee2fb0ad0e9cf00a19e5f0ffe2ef9e7aab2b383bb72d490e803ff9d731c800f2。
  - contract：`node --max-old-space-size=256 scripts/contract-check.mjs`；stdout SHA256 `1da8e86468137f802419573013ae77adf92a595f8e982ff4c80fb8c78c35cc52`。
  - comms replay：`node --max-old-space-size=256 scripts/comms/replay.mjs`；stdout SHA256 `9b8b69fe6612ff44ea3d8a068e837197a0e513de3cadc2921d2ed7fd052e4c82`。
  - comms compare：`node --max-old-space-size=256 scripts/comms/compare.mjs`；stdout SHA256 `1778736ff64ef22d630de8ced5443ce1a1080ba13d99cf06a8ecdf332d0bb047`，报告结果 PASS。
  - harness validate：`node --max-old-space-size=256 harness/src/cli.mjs validate --spec harness/specs/tasks/session-task-review-fixes-20261125.md`；stdout SHA256 `72f9fb03c21603eaac94cab320bfef4d96fa7b41eb26678ed979e06b646d9010`，输出 `Spec is valid`。
  - harness dry-run：`node --max-old-space-size=256 harness/src/cli.mjs run --spec harness/specs/tasks/session-task-review-fixes-20261125.md --dry-run`；stdout SHA256 `90cba72d35e37719d4efe01661af2d9680b8ead9324fb864718bb41b18157a5d`，输出 `Harness result: pass`。
  - 五项 stderr 均为空，SHA256 均为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。日志目录：`D:/tmp/session-task-relay-20261126-01a213b9/development-light/light/`。
- heavy-acceptance-deferred.json 记录 checks、runtime、desktop、electron、harness-ci 五组 r7 作业均 cancelled，after.processes 为空，原因是用户要求先完成代码开发。当前未运行这些门禁、测试或构建，结果保持延期。
