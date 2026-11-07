---
id: durable-task-runtime-build
title: 保留完整产物的低峰值内存 Runtime 构建
lifecycleStatus: active
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 8bfeb2108
intent: 为完整任务系统验收增加显式串行构建模式，每个既有 tsdown 配置在独立子进程中完成，保留全部包、统一运行时图、类型声明与最终检查。
requiredRules:
  - disk-temp-policy
  - repository-artifact-retention
  - docs-sync
requiredProfiles:
  - fast
expectedUserBehavior:
  - 内存紧张的 Windows 环境能够显式选择串行构建，产物与准入检查范围保持完整。
touchedAreas:
  - openclaw_runtime/tsdown.config.ts
  - openclaw_runtime/scripts/tsdown-build.mjs
  - openclaw_runtime/scripts/build-plugin-sdk-source-dts.mjs
  - openclaw_runtime/scripts/build-plugin-sdk-source-dts.test.mjs
  - openclaw_runtime/scripts/tsdown-serial-build.test.mjs
  - tests/unit/durable-task-build.test.ts
  - docs/dev/durable-task-system/**
  - harness/specs/tasks/durable-task-runtime-build.md
requiredTests:
  - node --test openclaw_runtime/scripts/tsdown-serial-build.test.mjs openclaw_runtime/scripts/build-plugin-sdk-source-dts.test.mjs
acceptance:
  - 串行模式逐个运行全部配置，失败时保留原退出码与诊断，不继续后续配置。
  - 默认构建行为保持原配置；统一运行时图不被分割。
  - 完整构建实测有退出记录和产物，不将跳过 dts 或插件的构建计为完整通过。
docs:
  required: true
  files:
    - docs/dev/durable-task-system/STATUS.md
---

基线构建在 tsdown 并发阶段超时及 8 GiB 堆耗尽。新增模式使用 `OPENCLAW_TSDOWN_SERIAL=1` 显式启用，不关闭任何已有 gate。
