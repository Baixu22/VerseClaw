---
lifecycleStatus: active
id: coding-mcp-result-fidelity
title: TF-0773 MCP错误、媒体和取消语义一致性
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: e1c20a9b9
intent: 让HTTP loopback、stdio plugin和Main诊断保留工具失败及SDK合法内容，取消与超时不被提升为成功。
touchedAreas:
  - harness/specs/tasks/coding-mcp-result-fidelity.md
  - openclaw_runtime/src/gateway/mcp-http.handlers.ts
  - openclaw_runtime/src/gateway/mcp-http.protocol.ts
  - openclaw_runtime/src/gateway/mcp-http.request.ts
  - openclaw_runtime/src/gateway/mcp-http.ts
  - openclaw_runtime/src/mcp/plugin-tools-handlers.ts
  - openclaw_runtime/src/mcp/tools-stdio-server.ts
  - openclaw_runtime/src/agents/agent-bundle-mcp-materialize.ts
  - openclaw_runtime/src/agents/agent-bundle-mcp-runtime.ts
  - openclaw_runtime/src/agents/agent-bundle-mcp-types.ts
  - openclaw_runtime/src/agents/agent-tools.before-tool-call.ts
  - openclaw_runtime/src/shared/mcp-tool-result.ts
  - electron/services/tool-protocol-shadow.ts
  - tests/unit/mcp-result-fidelity.test.ts
  - tests/unit/mcp-approval-fidelity.test.ts
  - tests/unit/tool-protocol-shadow.test.ts
  - tests/integration/mcp-result-sdk.test.ts
  - tests/fixtures/mcp-result-server.mts
  - tests/fixtures/mcp-result-tools.ts
  - harness/specs/fixtures/coding-fixes/TF-0773/**
  - docs/modules/integrations-and-surfaces.md
expectedUserBehavior:
  - 合法text/image/audio/resource/resource_link和structuredContent通过实际协商版本的SDK验证。
  - 工具details.status=error、isError、抛错、审批等待及取消超时均保留失败或等待语义。
  - 初始化按MCP规则协商版本；后续未知版本请求明确拒绝，取消后的迟到结果不进入其他运行。
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - docs-sync
  - disk-temp-policy
requiredTests:
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/gateway/mcp-http.runtime.test.ts src/agents/agent-bundle-mcp-runtime.test.ts src/agents/agent-tools.before-tool-call.cancellation.test.ts src/agents/agent-tools.before-tool-call.reliability.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run tests/unit/mcp-result-fidelity.test.ts tests/unit/mcp-approval-fidelity.test.ts tests/unit/tool-protocol-shadow.test.ts tests/integration/mcp-result-sdk.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/coding-mcp-result-fidelity.md
acceptance:
  - A9两个原始失败反例保留；HTTP与stdio经真实SDK客户端正常及负例往返通过。
  - 媒体和structuredContent按协商版本保留；必要降级为合法文本且明确记录损失。
  - 错误、审批、取消、超时和部分结果跨适配器及Main shadow不产生false success；迟到帧不跨run。
  - 同候选命令退出码、测试count/skip、请求及效果读回、源码产物摘要、凭据扫描和进程清理齐备。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/integrations-and-surfaces.md
  note: 修复既有MCP协议适配器，主README按现有模块文档入口复核。
---

TF-0758/P3，A9。沿用既有MCP SDK、工具审批钩子与传输取消owner；产物标记driven_by: agent，不更改产品默认值。
