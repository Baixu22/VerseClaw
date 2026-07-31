---
id: windows-ui-v2-apple-motion
title: ClawX Windows UI v2 Apple motion and materials
scenario: windows-ui-v2
taskType: implementation
intent: Replace the Windows renderer shell with a ClawX-branded Apple-inspired material and motion system, render settings as a route-driven Vaul drawer, and migrate shared page surfaces without changing runtime behavior.
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
  - Windows starts in UI v2 with a translucent split-view shell; macOS and Linux retain the legacy shell.
  - The query parameter `uiVersion=legacy` provides a development-only rollback without changing persisted settings or host contracts.
  - Settings opens from the right as a modal, draggable drawer while the previous page remains mounted behind it.
  - Opening Settings leaves the background page visually stationary and does not invalidate the Chat render tree.
  - Settings deep links, section navigation, focus restoration, reduced motion, nested dialogs, and existing test ids continue to work.
  - Chat and shared page surfaces use the same compact typography, material hierarchy, and motion presets without changing business behavior.
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
  - Windows title-bar controls remain visible and clickable above UI overlays.
  - UI v2 large surfaces use shared transform/opacity motion and respect reduced-motion.
  - The Settings drawer uses an opaque token surface without full-window or nested backdrop filters.
  - Settings overlay state does not propagate through the stable UI-version context used by Chat.
  - Vaul is pinned and imported only through the local AppleDrawer wrapper.
  - Settings does not replace or unmount the background route and navigates away only after its close animation completes.
  - Nested Radix overlays remain interactive inside the settings drawer.
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
