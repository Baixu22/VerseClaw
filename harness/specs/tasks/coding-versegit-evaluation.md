---
lifecycleStatus: active
id: coding-versegit-evaluation
title: TF-0775 VG 编码观测与候选反馈评测
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: d32f2d095
intent: 用固定 VG 二进制和当前 ClawX 候选检验宿主模式、跨文件风险、反馈到达与候选回执拒绝，不修改产品默认值。
touchedAreas:
  - harness/specs/tasks/coding-versegit-evaluation.md
  - scripts/coding-evaluation/versegit.mts
  - scripts/coding-evaluation/verify-versegit.mjs
  - scripts/coding-evaluation/verify-versegit.d.mts
  - tests/unit/coding-versegit-evaluation.test.ts
  - tests/unit/versegit-fact-adapter.test.ts
  - tests/e2e/versegit-runtime-bindings.spec.ts
  - tests/e2e/versegit-feedback-delivery.spec.ts
  - tests/e2e/versegit-feedback-paired.spec.ts
  - tests/e2e/versegit-candidate-apply.spec.ts
  - scripts/versegit-product-paired-evaluation.mts
  - scripts/versegit-feedback-delivery-probe.mts
  - scripts/versegit-runtime-bindings-probe.mts
  - scripts/versegit-candidate-apply-probe.mts
  - electron/services/versegit-fact-adapter.ts
  - electron/gateway/versegit-bridge.ts
  - electron/services/versegit-observation.ts
  - electron/services/versegit-receipt-evidence.ts
  - shared/versegit-runtime-contract.ts
  - docs/modules/verse-tools.md
  - harness/specs/fixtures/coding-evaluation/TF-0775/**
expectedUserBehavior:
  - VG 的原生 capability 与宿主授权分别记录；M0 无效果，M1 只读，M2/M3 按既有受限契约执行，M4 拒绝。
  - 支持的跨文件 producer-consumer 与 rename/delete 风险有实际文件和反馈证据。
  - 过期身份、缺失 basis、伪造或错候选回执、错 binary/schema 被现有 owner 拒绝。
  - produced、host-delivered、transcript-confirmed 和后续行为分别保留；未观测渠道记录 unknown/partial。
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/versegit-fact-adapter.test.ts tests/unit/versegit-mc4-adapter.test.ts tests/unit/versegit-runtime-bindings.test.ts tests/unit/versegit-observation-basis.test.ts tests/unit/versegit-feedback-delivery.test.ts tests/unit/versegit-candidate-freeze.test.ts tests/unit/versegit-candidate-receipts.test.ts tests/unit/versegit-receipt-authority.test.ts tests/unit/versegit-host-apply.test.ts tests/unit/coding-versegit-evaluation.test.ts --maxWorkers=1
  - pnpm run test:e2e:run tests/e2e/versegit-runtime-bindings.spec.ts tests/e2e/versegit-feedback-delivery.spec.ts tests/e2e/versegit-feedback-paired.spec.ts tests/e2e/versegit-candidate-apply.spec.ts
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/coding-versegit-evaluation.md
acceptance:
  - 实际二进制 SHA/version/capabilities 与冻结 manifest 一致，source 指针和宿主六维事实独立记录。
  - 真实文件跨会话读写、跨文件依赖、rename/delete 以及旧 epoch/乱序/缺 basis 有正反读回。
  - 反馈产生、交付、记录到 transcript 与三轮普通行为对照均有当前候选证据。
  - 错 binary/schema/身份及伪造、过期、错候选回执均拒绝，M4 未授权效果为零。
  - 同候选源码/命令/退出码/count/skip、实际效果、摘要、凭据扫描、进程清理与独立证据复算完成后收口。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/verse-tools.md
  note: 宿主 observation 确认语义在模块文档说明；根 README 保留同一模块入口。
---

TF-0758/E1。VG binary/source 以 resources/versegit/manifest.json 固定；调用现有 fact adapter、observation/binding bridge、receipt 与 journal owner。评测输入和控制边界记录为 agent 驱动。
