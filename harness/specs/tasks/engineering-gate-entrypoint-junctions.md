---
id: engineering-gate-entrypoint-junctions
title: 工程门禁通过目录联接执行时保持真实退出码
scenario: system-maturity-traceability
taskType: engineering-acceptance
intent: 修复 TF-0127 复核发现的目录联接空跑，把既有入口判断复用于契约、产物完成等级和生产可达性检查，确保失败输入不能以 exit 0 静默通过。
touchedAreas:
  - scripts/contract-check.mjs
  - scripts/lint-artifact-completion-class.mjs
  - openclaw_runtime/scripts/check-production-reachable.mjs
  - tests/unit/engineering-gate-entrypoints.test.ts
  - harness/specs/tasks/engineering-gate-entrypoint-junctions.md
  - docs/dev/handoffs/LATEST.md
  - .agent-workbench/task-forest/**
  - artifacts/agent-dev-workbench/evidence.json
expectedUserBehavior:
  - 从真实路径或 Windows 目录联接启动三个检查时，均运行实际检查并报告结果。
  - 缺失契约输入、非法产物参数和缺失可达性报告参数在两种路径下均返回对应非零退出码。
  - 作为模块导入时不执行 CLI，不输出检查结果或结束调用方进程。
requiredProfiles:
  - fast
requiredRules:
  - agent-engineering-acceptance-boundary
  - system-maturity-traceability
humanEvidence: not-required
forbiddenPatterns:
  - 硬编码本机盘符或仓库路径作为入口判断
  - 只断言源码文本而不执行真实 Node 子进程
  - 通过更改检查规则、基线或产品锁让失败输入通过
requiredTests:
  - pnpm exec vitest run tests/unit/engineering-gate-entrypoints.test.ts tests/unit/contract-check.test.ts tests/unit/artifact-completion-class-lint.test.ts
  - node --test openclaw_runtime/scripts/check-production-reachable.test.mjs
  - pnpm agent-dev:fast
  - pnpm harness validate --spec harness/specs/tasks/engineering-gate-entrypoint-junctions.md
acceptance:
  - 回归测试创建临时目录联接（POSIX 使用目录符号链接），在真实路径与别名路径下运行实际脚本；修复前三个失败输入在别名路径均错误地 exit 0，修复后依次为 1、1、3。
  - 正常契约输入和两个 CLI 的帮助或根列表输出在两种路径下保持一致且非空。
  - 三个脚本作为模块导入时保持无副作用，主调进程继续执行。
  - 不改运行时、默认值、真人计数、已有降级裁决或工程验收基线。
docs:
  required: true
  files:
    - docs/dev/handoffs/LATEST.md
---

归属 RC-01R（TF-0029）下单一修复节点。源问题见 TF-0127 的目录别名复核记录：Node 将模块 URL 解析为真实路径，argv 中仍保留目录联接路径，字符串比较使检查跳过。复用 scripts/lib/entrypoint.mjs 的 realpath 判断；不以此修复宣称整个 RC-01R 或 M4 已验收。
