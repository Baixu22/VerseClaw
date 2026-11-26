---
lifecycleStatus: active
id: appearance-personalization
title: Personalize accent and conversation typography
scenario: appearance-personalization
taskType: implementation
intent: Let desktop users adjust the interface accent and conversation reading style alongside the theme mode.
touchedAreas:
  - .gitignore
  - scripts/repository-artifacts.json
  - src/App.tsx
  - src/stores/settings.ts
  - src/lib/appearance.ts
  - src/components/settings/AppearanceControls.tsx
  - src/components/settings/AppearanceConversationPreview.tsx
  - src/components/settings/primitives/SettingsControls.tsx
  - src/components/ui/switch.tsx
  - src/components/ui/select.tsx
  - src/components/ui/button.tsx
  - src/components/rareui/ThemeSelector.tsx
  - src/components/chat/EffortPreviewSlider.tsx
  - src/pages/Settings/SettingsPageChrome.tsx
  - src/pages/Settings/SettingsSidebar.tsx
  - src/pages/Settings/SettingsRoute.tsx
  - src/components/assistant-render/UserMessageBubble.tsx
  - src/pages/Settings/index.tsx
  - src/pages/Chat/ChatMessage.tsx
  - src/styles/**
  - shared/i18n/locales/**
  - tests/e2e/appearance-personalization.spec.ts
  - tests/e2e/settings-theme-css.spec.ts
  - tests/e2e/settings-controls-fakecoding.spec.ts
  - docs/dev/settings-theme-acceptance.md
  - harness/specs/fixtures/appearance-personalization/**
  - tests/unit/appearance-personalization.test.ts
  - harness/specs/tasks/appearance-personalization.md
  - harness/specs/scenarios/appearance-personalization.md
  - harness/specs/rules/appearance-personalization.md
  - README*.md
expectedUserBehavior:
  - Choose a preset or custom accent and adjust conversation size and typeface in General settings.
  - See changes immediately in a reading sample and in the conversation.
  - Reopen the app with the saved appearance or restore appearance defaults independently.
requiredProfiles:
  - fast
  - e2e
requiredRules:
  - appearance-personalization
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm run i18n:lint
  - pnpm run typecheck:web
  - pnpm exec vitest run tests/unit/appearance-personalization.test.ts
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/appearance-personalization.spec.ts tests/e2e/settings-theme-css.spec.ts tests/e2e/settings-controls-fakecoding.spec.ts --workers=1
acceptance:
  - At 1280 by 800 the controls and reading sample share the first viewport. At 375 CSS pixels with extra-large Settings text the sample follows the controls and the controls fit the column.
  - A legacy profile opens with the original accent, system typeface and existing message sizes.
  - Custom accents adapt to both light and dark surfaces and keep status colors distinct.
  - Agent-driven Electron interaction verifies keyboard editing, rendered messages, persistence and scoped reset.
  - All registered Settings pages paint the selected canvas. Page and portal controls use consistent colors, and increasing settings text leaves the conversation size unchanged.
  - Measured accent contrast reaches 4.5 on the card in both modes. Disabled and destructive states remain distinguishable. Switching back to Original restores the measured palette.
  - See docs/dev/settings-theme-acceptance.md for route, interaction, visual and persistence criteria.
docs:
  required: true
  paths:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---
