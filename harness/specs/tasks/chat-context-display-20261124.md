---
id: chat-context-display-20261124
title: 聊天上下文 TokenTag 与组成追踪
lifecycleStatus: active
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
diffBase: 1f87f31d5d7064e97b53eed03d1f12862ff43fc3
intent: 复用 Lobe UI TokenTag，为聊天输入框提供上下文用量、悬停组成详情和持久化显示开关。
requiredRules:
  - backend-communication-boundary
  - i18n-locale-coverage
  - ui-motion-material-system
  - docs-sync
  - disk-temp-policy
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - src/components/chat/ChatContextIndicator.tsx
  - src/components/chat/ChatContextPressure.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Settings/index.tsx
  - src/stores/settings.ts
  - src/lib/host-api.ts
  - src/styles/codex-composer-shell.css
  - electron/services/usage-api.ts
  - electron/utils/session-context.ts
  - electron/utils/store.ts
  - shared/types/context-display.ts
  - shared/types/workspace.ts
  - shared/host-api/contract.ts
  - shared/i18n/locales/*/chat.json
  - shared/i18n/locales/*/settings.json
  - tests/unit/chat-context-indicator.test.tsx
  - tests/unit/chat-context-pressure.test.tsx
  - tests/unit/session-context.test.ts
  - tests/unit/usage-live-scope.test.ts
  - tests/unit/chat-input.test.tsx
  - tests/e2e/chat-context-display.spec.ts
  - tests/e2e/chat-context-pressure.spec.ts
  - tests/e2e/chat-manual-compaction.spec.ts
  - README*.md
  - docs/modules/context-and-memory.md
  - harness/specs/tasks/chat-context-display-20261124.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/ui-motion-material-system.md
expectedUserBehavior:
  - 输入框仅显示无填充的线条圆环；已用量和模型容量在悬停详情显示，高用量状态可辨认，未知读数显示明确的待测状态。
  - 悬停或键盘聚焦展示上下文组成；点击可保持详情，Escape 和外部点击关闭。
  - 标题、用量与关闭入口保持可见；文件、技能、工具和记忆来源在独立区域滚动。
  - 详情采用紧凑分项表格、来源颜色和所记录字符的占比条；详细来源动作可展开全部来源组。
  - 详情按运行时报告显示系统指令、项目文件、技能、工具定义及当前请求；展开来源可检查名称、字符数和截断状态。
  - 历史消息和会话内近期记忆回执显示其来源与时间；回执单独记录，模型 Token 用量与组成字符计量分别标注。
  - 设置的外观区提供上下文展示开关，立即生效并在重启后保留。
acceptance:
  - 上下文用量采用当前运行时快照或当前请求测量，不将累计会话账单当作窗口占用。
  - 组成数据只读，绑定当前会话及代次，筛除原始提示、凭据和无关字段；缺少报告时显示具体状态。
  - 延迟返回、会话切换和重置不会展示上一会话的组成或记忆回执。
  - 完成四语、浅色/深色、窄窗口及键盘交互的 Electron 覆盖。
  - 设置读写沿用 host-api；所有测试证据标记为 agent 驱动。
  - 文件内容经真实报告生成器和Main接口显示；来源文件变化会更新界面计量，未测量的截断和摘要计数保持未知。
requiredTests:
  - pnpm exec vitest run tests/unit/session-context.test.ts tests/unit/chat-context-indicator.test.tsx tests/unit/chat-context-pressure.test.tsx tests/unit/usage-live-scope.test.ts tests/unit/chat-input.test.tsx --maxWorkers=1
  - pnpm run typecheck
  - pnpm run contract:check
  - pnpm run i18n:lint
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run build:vite
  - pnpm exec playwright test tests/e2e/chat-context-display.spec.ts tests/e2e/chat-context-pressure.spec.ts tests/e2e/chat-manual-compaction.spec.ts --workers=1 --retries=0
docs:
  required: true
  files:
    - docs/modules/context-and-memory.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

读取 OpenClaw 已持久化的 systemPromptReport 和当前会话的用量记录，经 Main 投影为名称、计量和状态。当前会话元数据采用运行时SQLite只读入口，数据库不存在时兼容旧JSON索引。记忆来源复用 injectionReceipts。组成中的字符数是运行时报告的计量，Token 总数来自模型用量记录。
