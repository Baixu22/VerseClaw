---
lifecycleStatus: active
id: coding-write-issues-269-271
title: 修复 Coding 写入准入、Host 别名与恢复快照覆盖
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: da3b066ca8cdd01f0eefc21a49a7fb8c9f8dbc40
intent: 将 stale 校验绑定实际 mutation lease，Host 文件保存使用既有 fs-safe owner，并保留损坏 sidecar 后的原恢复快照。
touchedAreas:
  - harness/specs/tasks/coding-write-issues-269-271.md
  - harness/specs/rules/coding-mutation-consistency-boundary.md
  - openclaw_runtime/src/agents/stale-write-guard.ts
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/agent-tools.read.ts
  - openclaw_runtime/src/agents/sandbox/remote-fs-bridge.ts
  - openclaw_runtime/src/agents/sessions/tools/write.ts
  - openclaw_runtime/src/agents/tools/write-journal.ts
  - openclaw_runtime/src/agents/tools/write-journal-core.ts
  - openclaw_runtime/src/agents/tools/stale-write-guard.test.ts
  - openclaw_runtime/src/agents/tools/write-journal.test.ts
  - openclaw_runtime/src/agents/tools/coding-write-admission.test.ts
  - openclaw_runtime/src/agents/agent-tools.workspace-boundary.test.ts
  - electron/services/files-api.ts
  - tests/unit/files-permissions-api.test.ts
  - tests/e2e/coding-file-save-boundary.spec.ts
  - docs/modules/workspace-and-coding.md
  - harness/specs/fixtures/coding-write-issues-269-271/verification.json
expectedUserBehavior:
  - 开启 stale guard 的写入在真实队列等待后重核上次读取内容；拒绝后文件及 journal 不增加未应用步骤。
  - acceptEdits 保存硬链接目标时明确拒绝，工作区外字节不变；普通保存及已批准的外部普通文件仍可写。
  - journal 重启遇到坏或缺失 meta 时保留全部原快照；下一次快照不复用已占用文件名。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - coding-mutation-consistency-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredTests:
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/coding-write-issues-269-271.md
  - node openclaw_runtime/scripts/run-vitest.mjs run src/agents/tools/coding-write-admission.test.ts src/agents/tools/stale-write-guard.test.ts src/agents/tools/write-journal.test.ts src/agents/agent-tools.workspace-boundary.test.ts src/agents/stale-write-guard.false-block.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run tests/unit/files-permissions-api.test.ts tests/unit/path-broker-resolved.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node node_modules/vite/bin/vite.js build
  - node scripts/build-openclaw-runtime.mjs
  - node node_modules/@playwright/test/cli.js test tests/e2e/coding-file-save-boundary.spec.ts --workers=1 --retries=0
acceptance:
  - 同一路径 journal lease 与原生 mutation queue 的两种等待均不绕过 stale 校验；journal 开/关、flag-off、未读及显式 override 保持各自语义。
  - stale 拒绝发生在文件效果之前；被拒绝的步骤不进入可撤销 journal，路径别名仍经已有 workspace/fs-safe 授权。
  - sandbox 缺失文件的数值退出码经既有 stat 确认缺失后允许重建；未知 probe 输出和仍存在文件的读取错误拒绝准入，不留未应用的 undo 步骤。
  - 真实 hardlink 保存被 Host 拒绝且外部字节保持；普通文件、plan/readOnly、junction 与外部审批回归通过；保存保留 inode、ACL 与现存读取句柄，父目录禁止创建文件时仍可保存获准写入的现存文件。
  - 重启跳过坏 meta 仍保留旧 preimage；缺失 meta、meta-only、有效与损坏混合及碰撞均不覆盖旧文件。
  - 已解析路径保留字面 ~ 目录；Host 保存、原生 write 和 journal 恢复不读写 home 展开后的另一文件。
  - journal 关闭时，既有完整文件重写不因 generic root reader 的默认字节上限误拒新鲜文件。
  - 既有 undo、checkpoint、patch journal 与新故障回归通过；源码、退出码、计数、原始日志和 agent 驱动证据可回读。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
  note: 落实现有写入与恢复边界，不调整权限模式、advanced 默认值或发布锁。
---

# 写入与恢复

对应 issue #269、#270、#271。回归用例使用独立的合成文件，验证锁等待后的写入准入、真实硬链接及恢复快照保留。实现复用原 mutation queue、journal 与 fs-safe。

验证结果与源码摘要记录在 `harness/specs/fixtures/coding-write-issues-269-271/verification.json`。
