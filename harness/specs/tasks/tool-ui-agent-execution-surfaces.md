---
id: tool-ui-agent-execution-surfaces
title: Render trusted Tool UI execution surfaces in Chat
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Project existing Chat runtime events, generated files, task steps, and permission approvals into official Tool UI execution surfaces without changing runtime authority or transport.
touchedAreas:
  - harness/specs/tasks/tool-ui-agent-execution-surfaces.md
  - components.json
  - package.json
  - pnpm-lock.yaml
  - src/components/tool-ui/**
  - src/components/assistant-render/TurnWorkPanel.tsx
  - src/components/assistant-render/turn-work-model.ts
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Chat/ExecutionGraphCard.tsx
  - src/pages/Chat/execution-projection.ts
  - src/pages/Chat/index.tsx
  - src/pages/Chat/task-visualization.ts
  - src/lib/generated-files.ts
  - shared/i18n/locales/en/chat.json
  - shared/i18n/locales/zh/chat.json
  - shared/i18n/locales/ja/chat.json
  - shared/i18n/locales/ru/chat.json
  - tests/unit/tool-ui-execution-surfaces.test.tsx
  - tests/unit/tool-ui-run-surfaces.test.ts
  - tests/unit/pending-run-approvals.test.tsx
  - tests/unit/execution-graph-card-badge.test.tsx
  - tests/unit/turn-work-panel.test.tsx
  - tests/e2e/chat-tool-ui-execution-surfaces.spec.ts
expectedUserBehavior:
  - Assistant messages render official approval, terminal, code diff, and progress payloads without exposing raw Tool UI JSON.
  - Active command output updates a read-only terminal surface and completed commands retain exit status and duration.
  - Generated file reports show only trustworthy before and after data, with workspace preview fallback when a diff cannot be proven.
  - Active and completed runs show a compact progress tracker while the Execution Graph remains the detailed event view.
  - Workspace permission approvals appear outside collapsed turn summaries and approve or deny only through the existing permissions host API.
  - Model-generated approval cards remain chat interactions and cannot grant workspace permissions.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - chat-loop-boundary
  - i18n-locale-coverage
  - comms-regression
requiredTests:
  - pnpm exec vitest run tests/unit/tool-ui-execution-surfaces.test.tsx tests/unit/tool-ui-run-surfaces.test.ts
  - pnpm run typecheck:web
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/chat-tool-ui-execution-surfaces.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Official Tool UI components are committed locally and do not require registry access at runtime.
  - No second assistant-ui Toolkit or runtime is registered.
  - Runtime projection is pure and merges command output by stable item or tool call identifier.
  - Chat terminal output is read-only and visually caps retained display content at the final 32 KiB.
  - Generated file projection refuses binary, oversized, missing, or unavailable modified baselines.
  - Host approvals call permissions.decideApproval and never send a chat interaction response.
  - Model approval cards send an interaction response and never call permissions.decideApproval.
  - Renderer code introduces no direct IPC, Gateway HTTP, or Gateway WebSocket access.
docs:
  required: false
---
