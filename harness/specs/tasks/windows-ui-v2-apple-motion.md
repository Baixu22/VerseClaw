---
lifecycleStatus: archived
id: windows-ui-v2-apple-motion
title: Cross-platform FakeCoding UI v2 foundation
scenario: windows-ui-v2
taskType: implementation
intent: Replace the renderer shell with a cross-platform FakeCoding-aligned grayscale material, compact controls, exact product SVGs, and restrained motion without changing runtime behavior.
touchedAreas:
  - harness/specs/tasks/windows-ui-v2-apple-motion.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/ui-motion-material-system.md
  - package.json
  - pnpm-lock.yaml
  - patches/**
  - src/App.tsx
  - src/styles/**
  - src/lib/ui-version.ts
  - src/components/layout/**
  - src/components/ui/**
  - src/pages/Settings/**
  - src/pages/Chat/**
  - shared/i18n/locales/**
  - tests/unit/**
  - tests/e2e/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/clawx-design-overview.md
expectedUserBehavior:
  - Windows, macOS, and Linux start in UI v2 with the same compact grayscale work-surface system; only native window controls differ.
  - The temporary `uiVersion=legacy` rollback is retired by TF-0027; compatibility query values resolve to the current shell without changing persisted settings or host contracts.
  - Settings retains its route and focus behavior while using the shared compact control and surface system.
  - Opening Settings uses the full-page shared chrome and remembers the application return route without transforming the application tree.
  - Settings deep links, section navigation, focus restoration, reduced motion, nested dialogs, and existing test ids continue to work.
  - Chat and shared page surfaces use the same compact sans typography, grayscale hierarchy, exact migrated SVGs, and motion presets without changing business behavior.
requiredProfiles:
  - fast
requiredRules:
  - ui-motion-material-system
  - renderer-loading-experience
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm run i18n:lint
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm exec vitest run tests/unit/ui-version.test.ts tests/unit/settings-drawer-routing.test.tsx
  - pnpm run test:e2e:run tests/e2e/windows-ui-v2.spec.ts tests/e2e/settings-drawer.spec.ts tests/e2e/startup-loading-experience.spec.ts tests/e2e/main-navigation.spec.ts
acceptance:
  - Platform-native title-bar controls remain visible and clickable above UI overlays.
  - Management page headings stay at or below 28px and no shared primary button renders as a blue solid CTA.
  - Shared buttons, inputs, menus, tabs, and tooltips use 28-36px compact dimensions without press-scale effects.
  - UI v2 large surfaces use shared transform/opacity motion and respect reduced-motion.
  - The Settings page and its nested overlays use opaque token surfaces without full-window backdrop filters.
  - Chat layout and messages do not subscribe to Settings overlay state; the temporary visual-version context is removed.
  - Vaul is pinned and imported only through the local AppleDrawer wrapper.
  - Settings returns to the remembered application route and restores focus; direct Settings links return to the application root.
  - Nested Radix overlays remain interactive inside the Settings page.
  - Existing backend, host-api, Gateway, persistence, and permission contracts are unchanged.
  - Existing stable settings URLs and test ids remain compatible.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - docs/clawx-design-overview.md
---

This task is a renderer-only product redesign. It does not authorize new backend calls, renderer transport paths, runtime policy, or persisted application settings.
