---
id: path-approval-issues-274-276
title: 工作区路径、文件审批与写入恢复目标一致性
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
diffBase: a2e4f931cf35c1f8b428371bbed9411827f52ec5
intent: 预检与创建使用同一 home 路径展开，外部写入批准绑定内容，journal 和 stale guard 跟随实际写入目标。
expectedUserBehavior:
  - 使用 ~/ 路径时，工作区预检与创建识别同一目录并继续拒绝 home 根目录。
  - 外部文件批准只允许已批准的内容写入，同字节数的新内容需要重新批准。
  - 写入与编辑的撤销恢复实际目标，读取后的过期检查识别同一文件。
touchedAreas:
  - electron/services/workspace-preflight.ts
  - electron/services/files-api.ts
  - openclaw_runtime/src/agents/session-read-hashes.ts
  - openclaw_runtime/src/agents/path-policy.ts
  - openclaw_runtime/src/agents/fact-rel-path.ts
  - openclaw_runtime/src/agents/stale-write-guard.ts
  - openclaw_runtime/src/agents/tools/write-journal.ts
  - openclaw_runtime/src/agents/tools/write-journal-core.ts
  - tests/unit/workspace-preflight.test.ts
  - tests/unit/files-permissions-api.test.ts
  - openclaw_runtime/src/agents/tools/coding-path-identity.test.ts
  - openclaw_runtime/src/agents/tools/write-journal.test.ts
  - tests/e2e/coding-file-save-boundary.spec.ts
  - docs/modules/workspace-and-coding.md
  - harness/specs/tasks/path-approval-issues-274-276.md
  - harness/specs/rules/coding-mutation-consistency-boundary.md
  - harness/specs/fixtures/path-approval-issues-274-276/**
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - coding-mutation-consistency-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/workspace-preflight.test.ts tests/unit/files-permissions-api.test.ts tests/unit/path-broker-resolved.test.ts --maxWorkers=1 --no-file-parallelism
  - node openclaw_runtime/scripts/run-vitest.mjs run src/agents/tools/coding-path-identity.test.ts src/agents/tools/write-journal.test.ts src/agents/tools/coding-write-admission.test.ts src/agents/tools/stale-write-guard.test.ts src/agents/agent-tools.workspace-boundary.test.ts src/agents/checkpoint-diff.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/path-approval-issues-274-276.md
  - node node_modules/vite/bin/vite.js build
  - node scripts/build-openclaw-runtime.mjs
  - node node_modules/@playwright/test/cli.js test tests/e2e/coding-file-save-boundary.spec.ts --workers=1 --retries=0
acceptance:
  - 真实 home 下的独有目录用 ~/ 输入和绝对路径预检得到同一目标；输入 rootPath 保留原值，home、drive 和 system 根拒绝规则保持。
  - 外部文件批准绑定规范化路径及 UTF-8 内容摘要；同字节数的新内容要求新批准，拒绝不消费原批准，原内容仍可获准写入且批准只消费一次。
  - write/edit 的 journal、锁、快照和 stale 路径复用实际 session tool 输入解析；apply_patch 使用自身既有路径解析。已解析绝对路径内的字面 ~ 目录和 file URL 解码出的特殊空格保持原目标，快照与恢复不再展开已解析文件名。
  - 对 ~/ 输入的真实写入，shadow 存在与缺失两种情况均撤销真实目标；shadow 字节保持，成功后移除已消费 journal，失败保留恢复证据。
  - 同一目标的 ~/ 与绝对路径写入共享 journal lease；读取 hash 使用实际目标，新鲜内容允许写入，变化内容按原 stale guard 拒绝。
  - workspaceOnly 对 home 越界目标在写入前拒绝；既有 hardlink、普通保存、坏 sidecar、checkpoint 与写入准入回归通过。
  - 命令退出码、计数、源码摘要、原始日志与 agent 驱动 fixture 结果均可从盘读回。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
  note: 在模块文档记录既有路径、批准和恢复契约；README 中工作区和权限模式的使用入口保持。
---

# 路径与批准

对应 GitHub #274、#275、#276。验证使用 agent 驱动的合成文件和审批操作，
home 目录内仅创建独有的小型 fixture，测试缓存、日志和恢复快照优先放在 D:/tmp。
保留已合并 #269–#271 的 literal ~、fs-safe 和损坏 journal 快照回归。
