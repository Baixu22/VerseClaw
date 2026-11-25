---
id: browser-issues-265-268
title: 浏览器批准、运行代次和网络出口修复
lifecycleStatus: active
taskType: runtime-bridge
scenario: gateway-backend-communication
diffBase: 9b1044cc0cb90f83f751875019d59ee68f92095a
intent: Bind browser effects to the approved page, current run and existing profile network owner.
expectedUserBehavior:
  - Browser access remains bound to the approved page, current task run and profile network policy.
  - Closing a browser session immediately revokes private-network access, and a late opening result cannot restore it.
touchedAreas:
  - .gitattributes
  - packages/versebrowser/src/engine/**
  - packages/versebrowser/tests/**
  - packages/versebrowser/integration-patches.json
  - packages/versebrowser/patches/**
  - electron/services/agent-browser-api.ts
  - electron/services/agent-browser-network-proxy.ts
  - openclaw_runtime/src/types/lydell-node-pty.d.ts
  - tests/unit/versebrowser-*.test.ts
  - harness/specs/tasks/browser-issues-265-268.md
  - harness/specs/rules/agent-browser-supervised-task-boundary.md
  - harness/specs/fixtures/browser-issues-265-268/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
requiredRules:
  - backend-communication-boundary
  - versebrowser-upstream-preservation
  - agent-browser-supervised-task-boundary
  - comms-regression
  - docs-sync
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm --dir packages/versebrowser exec vitest run tests/agent-browser-runtime-mode.test.ts tests/agent-browser-task-service.test.ts tests/agent-browser-replay-tool-executor.test.ts tests/agent-browser-same-origin-source-map-fetcher.test.ts tests/same-origin-js-fetcher.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm exec vitest run tests/unit/versebrowser-network-proxy.test.ts tests/unit/versebrowser-host-adapter.test.ts --maxWorkers=1 --no-file-parallelism
  - pnpm --dir packages/versebrowser run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Full access records the approved tab and exact origin; navigation, replacement tabs and debugger reattachment cannot mint a new approval. Raw network details, comparisons, parameter candidates, JS snippets and pending full-access results retain that approval across asynchronous reads, including revocation, expiry and renewal.
  - Progress, completion, error and cleanup belong to the captured task run. Cancelling or pausing an old run cannot change or disable cancellation of its successor.
  - A replay draft is claimed before dispatch. Concurrent, failed, timed-out or unknown-result sends cannot reuse the same approval. URLs, headers and JSON, form or text bodies reject canonical credential fields before a draft is created while retaining ordinary identifiers.
  - JS, SourceMap and replay requests use the existing session/profile network owner and pinned DNS, including redirects, expiry and revocation. Closing a session revokes its private-network approvals before asynchronous native cleanup, including closure outside the host API. An opening result cannot recreate a prepared private approval removed or replaced while awaiting completion. No global fetch fallback is permitted.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

# 修复与验证

对应 GitHub #265–#268，基线 `452f499c0be6c06a73c017dd1c00e3be125e279f`。
本批修复归属 VerseBrowser 调用链维护；采用独立工作树、单 worker 定向回归，
与已有 G4/G5 验证窗口错峰。所有交互和本地网络 fixture 标记为 `driven_by: agent`。

回归覆盖批准后跨 origin、同源导航、新建/切换/关闭标签页、撤权和到期，
取消/暂停后立即重试与旧进度/成功/异常晚到，并核对新运行的取消信号。
重放使用并发和响应丢失场景证明单次发送。网络测试通过本地 HTTP 服务与受控
DNS fixture 核对实际连接、私网拒绝、合法请求、重定向和撤权；不依赖外部网站。
