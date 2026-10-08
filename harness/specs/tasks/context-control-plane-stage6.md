---
id: context-control-plane-stage6
title: Context Control Plane Stage 6 Context Diff Why Included Policy Simulation Replay Debugger
taskType: runtime-authority-convergence
intent: >-
  Promote Stage 6 into a formal harness spec. A read-only projection surface
  explains one coding turn from PromptPlan/RequestEnvelope/Receipt-shaped facts
  and sanitized Local Control Plane reports: context diff, why-this-was-included,
  policy simulation dry-run, and replay-input debugger. The UI is an opt-in
  Developer panel that calls only typed host-api. It never writes context or
  permission authority, never replays effects, and never displays or persists
  raw payloads, credentials, or secrets. All projection functions are pure and
  deterministic, and product locks/defaults remain unchanged.
touchedAreas:
  - harness/specs/tasks/context-control-plane-stage6.md
  - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
  - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
  - shared/types/context-control-plane/stage6-control-plane-explain.ts
  - tests/unit/context-control-plane-stage6-contracts.test.ts
  - src/components/settings/ContextControlPlanePanel.tsx
  - src/pages/Settings/index.tsx
  - shared/i18n/locales/en/settings.json
  - shared/i18n/locales/zh/settings.json
  - shared/i18n/locales/ja/settings.json
  - shared/i18n/locales/ru/settings.json
  - tests/e2e/context-control-plane-stage6.spec.ts
ownerDecisions:
  - "D1 accepted: Stage 6 is a read-only projection. The Developer panel may not write PromptPlan, RequestEnvelope, Receipt, policy, grant, context, or effect authority."
  - "D2 accepted: replay debugger builds replayable input refs/digests only. It never re-executes tool calls, effects, writes, or provider requests."
  - "D3 accepted: policy simulation is a renderer-local pure dry-run over sanitized report projections. The path has no host-api write, no ledger, no receipt, and no file side effect."
  - "D4 accepted: the panel is an opt-in diagnostic surface. It does not flip defaultOn, liveReady, productApproved, or any feature default."
blockedBy: []
expectedUserBehavior:
  - "A developer can open Settings > Developer > Context Control Plane and inspect selected/omitted/why facts derived from PromptPlan-shaped inputs and sanitized context reports."
  - "Every selected and omitted entry shows a source report/section/ref and a localized, queryable reason; no raw prompt, tool output, credential, or payload is rendered."
  - "Policy simulation displays localized allow/drop decisions and reason labels and is deterministic; clicking it does not change reports, receipts, ledgers, files, or host-api call count."
  - "Replay debugger displays report ids, timestamps, evidence refs, planId/snapshotId refs, and plan/envelope digests with effectsReplayed=false and never runs an executor."
  - "The panel is default off and loaded only from the opt-in Developer section through typed host-api; no direct Gateway HTTP/WebSocket/IPC call is added."
  - "Product locks remain false; no commit, push, or PR is created."
requiredProfiles:
  - fast
requiredRules:
  - runtime-authority-convergence-boundary
  - context-family-boundary
  - active-config-guards
  - backend-communication-boundary
  - api-client-transport-policy
humanEvidence: not-required
forbiddenPatterns:
  - making the UI a second context, permission, policy, receipt, or effect authority
  - replaying tool calls, effects, provider requests, writes, or any executor body
  - adding direct window.electron.ipcRenderer.invoke or direct Gateway HTTP/WebSocket calls in renderer code
  - rendering or persisting raw payload, prompt text, tool output, credentials, or secrets
  - using Date.now, new Date, Math.random, or wall-clock inside pure projection/simulation functions
  - changing defaultOn, liveReady, productApproved, or any product flag default
  - adding a durable store, database, permission table, receipt store, or new provider
  - committing, pushing, or creating a PR
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/context-control-plane-stage6.md
  - pnpm harness validate --spec harness/specs/tasks/context-control-plane-stage6.md
  - pnpm exec vitest run tests/unit/context-control-plane-stage6-contracts.test.ts --reporter=verbose
  - pnpm contract:check
  - pnpm run typecheck
  - pnpm run lint:check
  - pnpm i18n:lint
  - pnpm run test:e2e tests/e2e/context-control-plane-stage6.spec.ts
  - git diff --check
acceptance:
  - "L1: Pure projection functions consume PromptPlan/RequestEnvelope/Receipt-shaped refs and sanitized Local Control Plane reports; the UI contains no write path and no direct Gateway/IPC transport."
  - "L2: Context diff lists selected and omitted entries with source id, status, reason, order, and policy digest/epoch/ruleId; every entry is explainable."
  - "L3: Policy simulation is a pure dry-run; negative tests and E2E host-call count prove zero write/effect/ledger/file side effect."
  - "L4: Replay debugger output contains only report ids, timestamps, evidence refs, planId/snapshotId refs, plan/envelope digests, and effectsReplayed=false; no executor or effect replay path exists."
  - "L5: No raw payload, prompt text, tool output, credential, or secret is rendered or persisted; projections only carry ref/digest/summary/status."
  - "L6: The user-visible panel is reached through typed host-api and Settings > Developer; all strings, including reason and decision labels, are in en/zh/ja/ru; the Electron E2E spec covers the visible interactions."
  - "L7: Projection and simulation outputs are deep-equal for equal inputs; source scan finds no wall-clock or randomness in pure functions; default state stays off."
  - "L8: All required gate commands pass; product locks remain false, no key is persisted, no commit/push/PR exists."
docs:
  required: true
  files:
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/DEVELOPMENT-CONSTRAINTS.zh-CN.md
    - docs/dev/context-control-plane/stage0/golden-path-contract.md
    - docs/dev/context-control-plane/stage0/artifacts-schema.md
    - docs/dev/context-control-plane/stage0/authority-adapters.md
    - docs/dev/adr/2026-08-16-context-authority-boundaries.md
    - docs/dev/context-capability-blueprint.md
    - harness/specs/tasks/context-control-plane-stage5.md
---

# Context Control Plane Stage 6

Stage 6 turns the control-plane evidence into a user-understandable,
read-only product surface.

1. `shared/types/context-control-plane/stage6-control-plane-explain.ts`
   owns deterministic projection, why-explanation, policy dry-run, and
   replay-input builders. All functions are pure and receive observation
   times from callers.
2. `src/components/settings/ContextControlPlanePanel.tsx` is the only
   user-visible entry. It calls existing typed `hostApi.localControlPlane`
   status/reports/correlations and renders only sanitized ref/digest/summary
   facts.
3. The panel is mounted in the opt-in Settings > Developer section and has
   en/zh/ja/ru strings plus an Electron E2E spec.

The panel never mutates prompt plans, receipts, grants, policy, ledgers,
files, or effects. Replay means input reconstruction only, never re-execution.
