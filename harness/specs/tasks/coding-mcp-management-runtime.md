---
lifecycleStatus: active
id: coding-mcp-management-runtime
title: TF-0772 MCP管理请求与会话运行时贯通
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 1fb12d4e1
intent: 将Main的MCP目录、调用和心跳接入既有session MCP owner，显式区分空目录与失败并保持权限及代际一致。
touchedAreas:
  - harness/specs/tasks/coding-mcp-management-runtime.md
  - electron/services/mcp-api.ts
  - electron/main/ipc-handlers.ts
  - electron/services/workspace-permissions.ts
  - electron/services/gateway-api.ts
  - shared/types/mcp.ts
  - shared/host-api/contract.ts
  - src/stores/mcp.ts
  - src/pages/Skills/index.tsx
  - openclaw_runtime/src/gateway/server-methods.ts
  - openclaw_runtime/src/gateway/methods/core-descriptors.ts
  - openclaw_runtime/src/gateway/server-methods/mcp-management.ts
  - openclaw_runtime/src/gateway/server-methods/tools-invoke.ts
  - openclaw_runtime/src/gateway/server-methods/tools-invoke-mcp-fallback.test.ts
  - openclaw_runtime/src/gateway/tools-invoke-shared.ts
  - openclaw_runtime/src/gateway/tools-invoke-http.ts
  - openclaw_runtime/src/gateway/tool-resolution.ts
  - openclaw_runtime/packages/gateway-protocol/src/schema/agents-models-skills.ts
  - openclaw_runtime/src/agents/agent-bundle-mcp-runtime.ts
  - openclaw_runtime/src/agents/agent-bundle-mcp-types.ts
  - tests/unit/mcp-api.test.ts
  - tests/unit/mcp-p4-003-runtime-surface.test.ts
  - tests/unit/tool-provider-registry.test.ts
  - tests/unit/workspace-permissions.test.ts
  - tests/unit/gateway-permissions-api.test.ts
  - tests/unit/mcp-management-runtime.test.ts
  - tests/e2e/coding-mcp-management.spec.ts
  - tests/e2e/fixtures/coding-mcp-server.ts
  - harness/specs/fixtures/coding-fixes/TF-0772/**
  - docs/modules/workspace-and-coding.md
  - docs/modules/integrations-and-surfaces.md
expectedUserBehavior:
  - 已注册MCP的目录/调用/heartbeat走Main到Gateway的真实SDK连接，空目录成功与连接失败不同。
  - 缺服务、未授权、网络拒绝、超时、旧会话和配置变更返回明确失败，不能显示success加空工具。
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
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/gateway/server-methods/tools-invoke-mcp-fallback.test.ts --maxWorkers=1
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run src/agents/agent-bundle-mcp-runtime.test.ts --maxWorkers=1
  - node node_modules/vitest/vitest.mjs run tests/unit/mcp-api.test.ts tests/unit/mcp-p4-003-runtime-surface.test.ts tests/unit/rc08a-mcp-host-native-tool-convergence.test.ts tests/unit/tool-provider-registry.test.ts tests/unit/workspace-permissions.test.ts tests/unit/gateway-permissions-api.test.ts tests/unit/mcp-management-runtime.test.ts --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run comms:replay
  - pnpm run comms:compare
  - node node_modules/@playwright/test/cli.js test tests/e2e/coding-mcp-management.spec.ts --workers=1
  - pnpm harness validate --spec harness/specs/tasks/coding-mcp-management-runtime.md
acceptance:
  - 真实本地MCP server经Main/Gateway的list/call/heartbeat闭环，有实际请求与返回值读回。
  - 缺服务/未授权/网络拒绝/空目录/超时/旧session分开判定，失败不伪装为空目录成功。
  - 目录和调用复用当前session runtime、effective tool policy、schema校验与before-tool-call审批钩子；配置reload后旧目录不被继续执行。
  - host-native Git仍为Main本地能力，不冒充MCP握手；外部MCP来自真实SDK。
  - clean候选、命令退出码、原始结果、进程清理、摘要及凭据扫描齐备，agent驱动如实标注。
docs:
  required: true
  readmeTranslations: not-required
  files:
    - docs/modules/workspace-and-coding.md
    - docs/modules/integrations-and-surfaces.md
  note: 修复既有管理入口断链；无默认值和发布级别变化。
---

TF-0758/P2，A8。复用Session Store、session MCP manager和既有工具策略/审批；不创建第二连接管理器。
