---
lifecycleStatus: active
id: g8-ui-clean-candidate
title: Verify chat output, composer menus and the integrated UI changes on one clean commit
taskType: runtime-bridge
scenario: gateway-backend-communication
diffBase: 7dcf31a44a1d9b3c16db19d84330d47d53d4bbc6
intent: Validate TF-0783 and TF-0819 against the current main implementation together with the separately committed sidebar and header changes.
memberTasks:
  - harness/specs/tasks/chat-output-visual-hierarchy.md
  - harness/specs/tasks/chat-composer-popovers.md
  - harness/specs/tasks/sidebar-session-row-polish.md
regressionRules:
  - harness/specs/rules/ui-motion-material-system.md
  - harness/specs/rules/rareui-interaction-adaptation.md
integrationValidationPaths:
  - tests/unit/chat-startup-hydration.test.ts
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/dev/rareui-interactions.md
  - harness/specs/rules/sidebar-session-row-controls.md
  - harness/specs/scenarios/sidebar-session-row-management.md
  - harness/specs/tasks/sidebar-session-row-polish.md
  - harness/specs/tasks/g8-ui-clean-candidate.md
  - harness/specs/tasks/chat-output-visual-hierarchy.md
  - harness/specs/tasks/chat-composer-popovers.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/fixtures/g8-ui-clean-candidate/**
  - src/components/brand/BrandLogo.tsx
  - src/components/chat/MemoryInjectionPanel.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/TitleBar.tsx
  - src/components/rareui/CompletionActivityMenu.tsx
  - src/components/rareui/NotificationBell.tsx
  - src/pages/Chat/ChatToolbar.tsx
  - src/pages/Chat/SessionActivityPanel.tsx
  - src/pages/Chat/index.tsx
  - src/stores/chat.ts
  - src/styles/codex-composer-material.css
  - src/styles/codex-session-activity.css
  - src/styles/codex-sidebar.css
  - src/styles/globals.css
  - src/styles/rareui-interactions.css
  - tests/e2e/main-navigation.spec.ts
  - tests/e2e/sidebar-session-row-polish.spec.ts
  - tests/e2e/chat-agent-effort.spec.ts
  - tests/e2e/chat-composer-git-strip.spec.ts
  - tests/e2e/chat-composer-popovers.spec.ts
  - tests/e2e/chat-task-visualizer.spec.ts
  - tests/e2e/chat-welcome-hero-fakecoding.spec.ts
  - tests/e2e/chat-welcome-hero-verse-shot.spec.ts
  - tests/e2e/rareui-interactions.spec.ts
  - tests/e2e/session-activity-background-read.spec.ts
  - tests/e2e/windows-ui-v2.spec.ts
  - tests/unit/rareui-interactions.test.tsx
  - tests/unit/chat-page-execution-graph.test.tsx
  - tests/unit/chat-startup-hydration.test.ts
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - comms-regression
  - i18n-locale-coverage
  - docs-sync
  - ui-motion-material-system
  - sidebar-session-row-controls
  - rareui-interaction-adaptation
  - repository-artifact-retention
  - disk-temp-policy
requiredProfiles:
  - fast
  - e2e
  - comms
requiredTests:
  - pnpm run typecheck:node
  - pnpm run typecheck:web
  - pnpm run typecheck:test
  - pnpm run i18n:lint
  - pnpm run build:vite
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm exec vitest run tests/unit/session-task-scope.test.ts tests/unit/long-session-delegation-admission.test.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/chat-startup-hydration.test.ts tests/unit/chat-load-sessions-startup.test.ts tests/unit/history-startup-retry.test.ts tests/unit/startup-loading-experience.test.tsx --maxWorkers=1
  - pnpm run test:e2e:run tests/e2e/startup-loading-experience.spec.ts tests/e2e/windows-ui-v2.spec.ts tests/e2e/settings-drawer.spec.ts tests/e2e/rareui-interactions.spec.ts
expectedUserBehavior:
  - Conversation output and composer menus retain the behavior required by their member task contracts after the sidebar and header changes are integrated.
  - The session environment, memory dialog and activity bell use the existing status glyphs and remain usable in light, dark, narrow and reduced-motion layouts.
acceptance:
  - Run every required unit and Electron test of the three member tasks on one committed candidate, together with the listed type, locale, build and communication gates. Shared tests may have one result referenced by multiple members.
  - Read the original TF-0819 polish test inputs and include its model identity, Git identity and reasoning-menu regressions; historical counts and images do not count as current results.
  - Compare the complete candidate delta to diffBase. Each changed source path must have an actual member-task owner. Shared rule regressions must be explicitly required by a listed regression rule; integrationValidationPaths declares the startup regression for this integration. Retain the path-by-path ownership report and run the complete changed-path Harness flow.
  - Validate repository CI prerequisites under repository-ci-g8-prerequisites. Their delta from the original main baseline 42ad5e0b223d935e57630eb20c3501640721bf2e and the G8 delta from diffBase must cover the complete integration without uncovered paths.
  - After an empty session has been confirmed ready, disconnecting the Gateway preserves its project and worktree controls. Initial unconfirmed history still waits for readiness, and a restarted Gateway reloads history.
  - The fourteen paths in the old TF-0783 mixed snapshot remain outside this change set. Record each original owner, its current main blob and its zero candidate delta. Any new change to one requires that owner's acceptance before integration.
  - Recheck the existing generation/links and taskRef/sessionGeneration mapping through the production caller, delegation tests and full test typecheck; do not recreate a fix already present in main.
  - Capture current screenshots, popover opening/closing samples, source hashes and Electron cleanup results. Source, test inputs and four-language resources stay unchanged throughout the successful gate runs.
  - Preserve shared-checkout bytes and staging. All execution evidence records driven_by=agent, actor and realHumanEvidence=false.
  - Apply a Task Forest closure proposal only after evidence readback verifies all gates and the current base_graph_hash matches.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
---

This is the acceptance contract for the combined candidate. The output hierarchy
and composer-menu contracts retain their original ownership boundaries. The
sidebar/header delta is committed separately and accepted by its own contract;
the integration report records both ownership and the complete comparison to the
accepted repository prerequisite above. That prerequisite contains lifecycle
metadata and independently validated contract/Agent Dev maintenance. Its source,
unit, type and CI checks remain separate from UI ownership.

The current main already contains the task-scope mapping repair from
`5d3f84ca9`. The fourteen files in the earlier mixed snapshot belong to Gateway
startup, session delegation and the coding convergence plan. Their historical
results remain attached to their original candidates.
