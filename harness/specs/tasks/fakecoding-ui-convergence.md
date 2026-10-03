---
id: fakecoding-ui-convergence
title: FakeCoding design-system and information-architecture convergence
scenario: windows-ui-v2
taskType: implementation
intent: Establish the cross-platform FakeCoding UI foundation, provide the serial migration contract for moving existing Verse Claw capabilities into Inbox, Scheduled, Chat workspace panels, and a focused Knowledge surface.
touchedAreas:
  - harness/specs/tasks/fakecoding-ui-convergence.md
  - harness/specs/tasks/windows-ui-v2-apple-motion.md
  - harness/specs/tasks/knowledge-hub-information-density.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/ui-motion-material-system.md
  - src/App.tsx
  - src/lib/ui-version.ts
  - src/styles/**
  - src/components/icons/**
  - src/components/layout/**
  - src/components/ui/**
  - src/pages/UiV2Showcase/**
  - shared/i18n/locales/**
  - tests/unit/ui-version.test.ts
  - tests/e2e/windows-ui-v2.spec.ts
expectedUserBehavior:
  - UI v2 is the shared desktop shell; TF-0027 retires the temporary legacy override after the serial migration flows pass.
  - The application shell uses continuous grayscale work surfaces, fine dividers, compact toolbars, sans headings, and restrained motion.
  - Shared primary actions use foreground/background inversion; blue is limited to links, keyboard focus, and running state.
  - Shared controls stay within the 28-36px density contract and do not bounce or scale on press.
  - Shared badges, switches, cards, textareas, menus, tooltips, dialogs, and sheets use compact grayscale states and opaque work surfaces.
  - Product navigation and commands can use migrated FakeCoding SVGs through one accessible React wrapper without changing icon geometry.
requiredProfiles:
  - fast
requiredRules:
  - ui-motion-material-system
  - renderer-loading-experience
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm run i18n:lint
  - pnpm exec eslint src/lib/ui-version.ts src/components/icons src/components/layout/MainLayout.tsx src/components/ui src/pages/UiV2Showcase tests/unit/ui-version.test.ts tests/e2e/windows-ui-v2.spec.ts
  - pnpm exec vitest run tests/unit/ui-version.test.ts tests/unit/fakecoding-design-system.test.ts
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/windows-ui-v2.spec.ts
acceptance:
  - `resolveUiVersion` resolves v2 for every supported desktop platform; old visual query values remain compatible after the TF-0027 retirement.
  - Light and dark semantic materials use neutral FakeCoding-aligned grays; light mode no longer uses a warm cream family.
  - Shared primary buttons are grayscale, normal controls are at most 36px high, and shared buttons/tabs contain no `active:scale` classes.
  - Shared badges and switches are grayscale by default; cards and sheets do not use backdrop blur; dialog motion uses only opacity and a necessary 4px translation.
  - Shared page headings use the sans stack, zero letter spacing, normal weight, and a maximum 28px size.
  - Main content has no page-level decorative gradient, nested glass stack, or platform-gated v2 layout.
  - Migrated Codex SVGs preserve their reference `viewBox`, `fill`, `stroke`, line cap, and line join behavior.
  - Existing backend, host-api, Gateway, persistence, security, and permission contracts are unchanged.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - docs/clawx-design-overview.md
---

The current Task Forest node covers only the design-system and application-shell foundation. Inbox, Scheduled, workspace Review/Browser, Knowledge convergence, and secondary-page cleanup remain dependent serial nodes and must not be claimed complete by this task.
