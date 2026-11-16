---
lifecycleStatus: active
id: process-control-backpressure-20261108
title: 保障共享进程控制响应与日志背压
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c84d7f0ff0a9fdc193626bf43e01738e047e422c
intent: 完成 TF-0836 / G26-G29，在既有VerseShell与日志owner上接通控制优先、引用释放和字节上限。
expectedUserBehavior:
  - Poll traffic leaves bounded capacity for stdin and cancellation within existing control deadlines.
  - Finishing one managed process preserves other users of its executor and retains bounded output with artifact readback.
touchedAreas:
  - openclaw_runtime/src/agents/verseshell/process-manager.ts
  - openclaw_runtime/src/agents/verseshell/process-manager.test.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.ts
  - openclaw_runtime/src/agents/verseshell/governed-process.test.ts
  - openclaw_runtime/src/agents/verseshell/control-backpressure.integration.test.ts
  - openclaw_runtime/src/agents/verseshell/control-backpressure.native.test.ts
  - openclaw_runtime/src/agents/sessions/bash-executor.ts
  - openclaw_runtime/src/agents/sessions/bash-executor.backpressure.test.ts
  - openclaw_runtime/src/agents/sessions/tools/private-temp-file.ts
  - openclaw_runtime/src/agents/byte-tail.ts
  - openclaw_runtime/test/vitest/vitest.process-control.config.ts
  - harness/specs/tasks/process-control-backpressure-20261108.md
  - harness/specs/rules/process-control-backpressure.md
  - harness/specs/fixtures/process-control-backpressure-20261108/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/modules/resources-and-observability.md
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - process-control-backpressure
  - resource-bounded-waiting
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
  - comms-regression
  - docs-sync
requiredTests:
  - node openclaw_runtime/node_modules/vitest/vitest.mjs run --root openclaw_runtime --config openclaw_runtime/test/vitest/vitest.process-control.config.ts --maxWorkers=1
  - node harness/src/cli.mjs validate --spec harness/specs/tasks/process-control-backpressure-20261108.md
  - node harness/src/cli.mjs run --spec harness/specs/tasks/process-control-backpressure-20261108.md --dry-run
  - node scripts/comms/replay.mjs
  - node scripts/comms/compare.mjs
  - git diff --check
acceptance:
  - Pending long polls cannot monopolize the existing executor concurrency or queue. Controls retain the existing 5000ms deadline; cancelled/expired requests do not start and every listener/timer is released.
  - Managed lifecycle references protect active executor owners from idle collection. One wait terminal releases only its reference; unknown process occupancy is retained and the final owned executor closes safely.
  - Host aggregation and file spill remain bounded by byte budgets for Unicode and single huge chunks, with explicit truncation and artifact readback through existing owners.
  - Native Node protocol and verified shipped ae.exe fixtures exercise concurrent polling, stdin/kill, shared-reference exit and output flood; confirm owned PID exit after cancellation.
  - Compare native typed file reads, CLI-per-call and persistent server on identical work; retain spawn, memory and latency measurements and record the selected or rejected design.
  - Freeze a clean candidate, verify focused tests/types/lint/comms/Harness and source/binary provenance, inspect artifacts and SHA256/credential scan before merge and closure.
docs:
  required: true
  readmeTranslations: required
  paths:
    - harness/specs/rules/process-control-backpressure.md
    - docs/modules/resources-and-observability.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

保持原有4并发/64队列、process控制5秒和native binary冻结合同。
调度在原host manager内保留控制空间；长poll在单额度配置下使用有界server等待片段。
复用managed capacity、executor进程身份、原artifact store与私有临时文件，不新建进程服务。

原生验收使用独立目录中与发布manifest完全同哈希的ae.exe副本；记录原路径的
E_PROCESS_PERSIST失败与独立副本成功。诊断编译产物只用于定位，不参与正式通过判定。
