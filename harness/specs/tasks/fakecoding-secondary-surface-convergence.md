---
id: fakecoding-secondary-surface-convergence
title: Secondary page convergence and visual rollback retirement
scenario: gateway-backend-communication
scenarios:
  - windows-ui-v2
taskType: runtime-bridge
intent: Finish TF-0027 by verifying the existing shared controls across secondary pages, removing remaining oversized management headings, aligning visual assertions with the established radius ladder, and retiring the visual-only legacy rollback after the supported flows pass.
touchedAreas:
  - harness/specs/tasks/fakecoding-secondary-surface-convergence.md
  - harness/specs/tasks/fakecoding-ui-convergence.md
  - harness/specs/tasks/windows-ui-v2-apple-motion.md
  - harness/specs/scenarios/windows-ui-v2.md
  - harness/specs/rules/ui-motion-material-system.md
  - src/App.tsx
  - src/lib/ui-version.ts
  - src/components/layout/ui-overlay-context.tsx
  - src/components/layout/MainLayout.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/settings/ProvidersSettings.tsx
  - src/pages/Chat/index.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/ChatMessage.tsx
  - src/pages/Knowledge/index.tsx
  - src/pages/Agents/index.tsx
  - src/pages/Models/index.tsx
  - src/pages/Channels/index.tsx
  - src/pages/Skills/index.tsx
  - src/pages/Setup/index.tsx
  - src/pages/Setup/ProviderModelSteps.tsx
  - src/pages/Observability/index.tsx
  - src/styles/globals.css
  - tests/unit/ui-version.test.ts
  - tests/unit/fakecoding-design-system.test.ts
  - tests/unit/knowledge-page.test.tsx
  - tests/unit/setup-provider-lifecycle.test.tsx
  - tests/e2e/windows-ui-v2.spec.ts
  - tests/e2e/knowledge-review-queue.spec.ts
  - tests/e2e/secondary-surfaces-convergence.spec.ts
  - tests/e2e/main-navigation.spec.ts
  - tests/e2e/observability-quick-locate.spec.ts
  - tests/e2e/setup-first-run-fp-p1-01.spec.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/clawx-design-overview.md
expectedUserBehavior:
  - Settings sections for General, Agents, Models, Channels and Skills use the shared page shell and compact controls.
  - Setup and Observability fit 1280x800 and 960x800 in light and dark themes without horizontal page overflow or oversized management headings.
  - The existing 1.25x corner-radius ladder remains the single source of component radii; visual checks verify its exact intended values rather than obsolete pre-scaling bounds.
  - Browser and Review compatibility URLs always open their existing workspace destinations; the old uiVersion query cannot restore duplicate navigation or obsolete page chrome after retirement.
  - Runtime flags, approval policy, Provider configuration, persistent data and Main-owned communication paths keep their current behavior.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-motion-material-system
  - renderer-loading-experience
  - i18n-locale-coverage
  - docs-sync
requiredTests:
  - pnpm run i18n:lint
  - pnpm run lint:check
  - pnpm exec vitest run tests/unit/ui-version.test.ts tests/unit/fakecoding-design-system.test.ts tests/unit/startup-loading-experience.test.tsx tests/unit/setup-provider-validation.test.ts tests/unit/setup-provider-lifecycle.test.tsx
  - pnpm run typecheck
  - pnpm run build:vite
  - pnpm run test:e2e:run tests/e2e/secondary-surfaces-convergence.spec.ts tests/e2e/windows-ui-v2.spec.ts tests/e2e/settings-drawer.spec.ts tests/e2e/settings-controls-fakecoding.spec.ts tests/e2e/startup-loading-experience.spec.ts tests/e2e/setup-first-run-fp-p1-01.spec.ts
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm run harness:ci
acceptance:
  - Secondary pages use shared controls and have no ordinary solid-blue CTA or decorative hero heading.
  - Both supported widths and themes preserve readable controls, navigation, details and all governed actions.
  - Observability metric labels and values keep their natural height when the trace workbench needs vertical scrolling.
  - Integrated Knowledge review selection remains bound to the active draft when a previously requested proposal arrives late; neither preview nor apply switches to another draft's proposal.
  - Late installation completion or an outgoing Setup control cannot advance a different step or bypass Provider/Model verification.
  - Provider and Model results become obsolete when the user changes selection or leaves the component; obsolete completions cannot start subsequent account/default/verification writes or restore parent readiness. Already-dispatched Host operations retain their existing service contract.
  - Visual-only legacy branches are removed after the supported route and interaction checks pass; compatibility query values safely resolve to the current UI.
  - Product locks and TF-0140 are unchanged.
  - All required checks pass; known unrelated failures remain explicit until their owning node resolves them.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - docs/clawx-design-overview.md
---

This node completes the existing UI migration in sequence after TF-0026. It does not authorize rewriting knowledge, runtime policy, provider credentials, backend routes, or the newer first-run animation design. The legacy work is limited to the visual rollback and duplicate page destinations, not data-format compatibility.
