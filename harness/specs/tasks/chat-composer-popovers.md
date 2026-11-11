---
lifecycleStatus: active
id: chat-composer-popovers
title: Simplify chat model selection and unify composer menus
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let users directly choose a model, remember that preference for new chats, retain each conversation's choice and unify adjacent menu visuals.
touchedAreas:
  - .gitignore
  - src/pages/Chat/ChatInput.tsx
  - src/components/chat/ComposerPopover.tsx
  - src/styles/codex-composer-menu.css
  - src/styles/codex-composer-material.css
  - src/styles/codex-composer-shell.css
  - src/styles/codex-tokens.css
  - src/styles/codex-welcome-hero.css
  - src/styles/codex-session-activity.css
  - src/components/chat/ModelBrandIcon.tsx
  - src/components/chat/ChatAgentEffortPopover.tsx
  - src/components/chat/WelcomeBranchPicker.tsx
  - src/components/chat/SessionWorkspacePicker.tsx
  - src/pages/Chat/ComposerGitStrip.tsx
  - src/pages/Chat/SessionActivityPanel.tsx
  - src/lib/model-brand.ts
  - src/lib/git-ui.ts
  - tests/unit/model-brand.test.ts
  - tests/unit/git-ui.test.ts
  - tests/unit/composer-git-strip.test.tsx
  - tests/unit/welcome-branch-picker.test.tsx
  - tests/unit/session-activity-panel-sections.test.tsx
  - tests/e2e/chat-composer-git-strip.spec.ts
  - src/styles/plus-menu-morph.css
  - src/lib/chat-model-selection.ts
  - src/stores/settings.ts
  - src/stores/chat.ts
  - src/pages/Chat/index.tsx
  - shared/chat/types.ts
  - tests/unit/chat-model-selection.test.ts
  - tests/unit/chat-target-routing.test.ts
  - tests/unit/chat-input.test.tsx
  - docs/dev/chat-model-selection.md
  - tests/e2e/chat-composer-popovers.spec.ts
  - tests/e2e/chat-model-picker.spec.ts
  - tests/e2e/chat-model-picker-tiers.spec.ts
  - tests/e2e/chat-agent-effort.spec.ts
  - harness/specs/tasks/chat-composer-popovers.md
  - harness/specs/rules/ui-motion-material-system.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/fixtures/chat-composer-popovers/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Composer menus use consistent neutral surfaces, rounded corners, spacing and trailing selection marks.
  - Composer cards use opaque soft-gray light and graphite dark surfaces. Ancestor backdrop filters must not leak transcript text through them.
  - Model names remain visible in narrow composers and wrap completely in the menu. LobeHub brand marks follow the model family even when a router provides it.
  - Main checkouts and linked worktrees are identified consistently in the composer and session status; detached HEAD remains distinct from checkout identity.
  - Opening uses the add menu's subtle slide, scale and blur-to-clear transition. Closing fades out and immediately disables interaction on the outgoing surface.
  - Opening an adjacent control closes the previous menu. Escape and outside click dismiss menus; Escape restores the composer focus.
  - Menus choose the available space above or below the trigger and scroll internally without shifting the composer.
  - The model menu shows available models immediately. The single-message, session and persistent scope selector is removed.
  - New chats use the most recently explicitly selected available model. Existing chats keep their own selection; a change applies to future messages. Agent defaults remain configured in Settings.
  - Model persistence uses hostApi.sessions.patchRuntimeModel. Failed saves retain the prior selection; obsolete completions never close or retarget another conversation's composer.
requiredRules:
  - ui-motion-material-system
  - i18n-locale-coverage
  - docs-sync
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - host-api-fallback-policy
  - comms-regression
requiredProfiles:
  - fast
  - e2e
  - comms
requiredTests:
  - pnpm exec vitest run tests/unit/chat-input.test.tsx --maxWorkers=1
  - pnpm run test:e2e:run tests/e2e/chat-composer-popovers.spec.ts
  - pnpm run test:e2e:run tests/e2e/chat-model-picker.spec.ts tests/e2e/chat-model-picker-tiers.spec.ts
  - pnpm exec vitest run tests/unit/chat-model-selection.test.ts tests/unit/chat-target-routing.test.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Light and dark menus stay within the viewport at 1280x800 and 760x560. Long lists and knowledge search remain reachable by scrolling.
  - Model, knowledge and permission menus expose only one interactive expanded surface at a time, including rapid switching.
  - Reduced motion removes the popover's slide, scale and blur; menu content remains visible and interactive.
  - Agent-driven Electron screenshots verify the add, model, reasoning, knowledge and permission controls in light, dark and narrow layouts. Animation samples verify opening blur, settled sharpness and inert closing surfaces.
  - The plus glyph is centered within its circular border at rest, including after closing. Selecting a model requires one choice with no scope-selection step.
  - Changing a saturated underlay beneath a settled menu produces identical interior screenshot pixels in both themes, including software-rendered Electron.
  - Long model names have no clipped lines or horizontal overflow at 1280 and 760 pixels; a selected long name remains readable after closing.
  - Linked-worktree screenshots include the composer strip, branch/worktree menu and session environment identity in both themes.
  - New-chat preference, existing-session restoration, removed-model fallback, failed persistence, queued sends and session-switch races have automated coverage.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

The small popovers follow the existing PlusMenuMorph timings: 300ms movement,
160ms opacity/blur, 10px displacement, 0.97 scale and 2px blur. At rest the
foreground filter is removed so text stays crisp. The settled card and its
composer ancestor use opaque surfaces without backdrop filters.
