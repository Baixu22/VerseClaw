---
lifecycleStatus: archived
id: uas-06-single-local-exec-canary
title: UAS-06 single local execution plane canary
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Route every eligible local exec/process call in an explicitly selected internal cohort through the governed VerseShell lifecycle without changing the model tool surface, adding per-call model routing, or permitting implicit native fallback.
ownedPaths:
  - package.json
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - harness/specs/tasks/uas-06-single-local-exec-canary.md
  - harness/specs/rules/verseshell-single-local-exec-canary-boundary.md
  - openclaw_runtime/src/config/zod-schema.agent-runtime.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/src/config/runtime-verseshell-foundation.test.ts
  - openclaw_runtime/src/agents/exec-defaults.ts
  - openclaw_runtime/src/agents/bash-tools.exec-runtime.ts
  - openclaw_runtime/src/agents/bash-tools.schemas.ts
  - openclaw_runtime/src/agents/verseshell/single-plane-canary.ts
  - openclaw_runtime/src/agents/verseshell/single-plane-canary.test.ts
  - openclaw_runtime/src/agents/verseshell/real-canary-evidence.ts
  - openclaw_runtime/src/agents/verseshell/real-canary-evidence.test.ts
  - openclaw_runtime/src/infra/diagnostic-events.ts
  - openclaw_runtime/src/logging/diagnostic-stability.ts
  - openclaw_runtime/src/logging/diagnostic-stability.exec.test.ts
  - openclaw_runtime/extensions/diagnostics-otel/src/service.ts
  - openclaw_runtime/test/vitest/vitest.verseshell.config.ts
  - scripts/uas-06-canary-evidence.mts
  - scripts/uas-06-real-canary.mts
  - tests/unit/uas-06-single-local-exec-canary.test.ts
  - artifacts/uas-06-single-local-exec-canary/**
  - docs/dev/verseshell-foundation/**
  - docs/dev/unified-agent-system/**
  - docs/dev/handoffs/LATEST.md
touchedAreas:
  - package.json
  - README*.md
  - harness/specs/**
  - openclaw_runtime/src/config/**
  - openclaw_runtime/src/agents/**
  - openclaw_runtime/src/infra/**
  - openclaw_runtime/src/logging/**
  - openclaw_runtime/extensions/diagnostics-otel/**
  - openclaw_runtime/test/vitest/**
  - scripts/**
  - tests/unit/**
  - artifacts/uas-06-single-local-exec-canary/**
  - docs/dev/verseshell-foundation/**
  - docs/dev/unified-agent-system/**
  - docs/dev/handoffs/LATEST.md
expectedUserBehavior:
  - An operator selects the canary at global, agent, or session scope with tools.exec.host=verseshell; the model-facing exec schema cannot select VerseShell per call.
  - Every non-sandboxed, non-node, non-elevated exec/process call in the selected scope uses the governed VerseShell lifecycle and never falls back to a native shell after a governed failure.
  - Sandbox, node, remote, provider-native, and elevated execution keep their existing owners and are excluded from the eligible-local denominator.
  - The foundation kill switch fails closed. Rollback requires an explicit operator configuration change back to the prior owner and never happens as an error fallback.
  - Canary evidence separates engineering matrix results from real provider usage, human recovery time, paired task completion, and soak observations.
  - Reviewed live observations contain only low-sensitivity diagnostic route fields, external provider receipt digests, and human attestations; they do not archive command text, prompts, transcripts, or credentials.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - active-config-guards
  - contract-first-boundary
  - capability-owner-resolution
  - runtime-local-ecosystem-boundary
  - supply-chain-integrity-pinning
  - comms-regression
  - docs-sync
  - verseshell-process-lifecycle-boundary
  - verseshell-single-local-exec-canary-boundary
forbiddenPatterns:
  - exposing verseshell in the model-facing exec host enum
  - selecting the execution plane with an LLM or per-call heuristic
  - native shell fallback after any governed VerseShell denial, outage, timeout, protocol mismatch, lifecycle loss, or process failure
  - counting sandbox, node, remote, provider-native, or elevated execution as eligible local VerseShell coverage
  - treating an engineering command matrix as real provider usage, human recovery, paired A/B, soak, ROI, or product approval
  - changing liveReady, productApproved, defaultOn, TF-0006, TF-0009, Runtime Memory, SEKB policy, or UAS-07/UAS-08 status
featureFlags:
  - The canary uses the existing default-off verifiedRuntime, typedAci, facade, and governedExec gates plus an explicit tools.exec.host=verseshell scope selection.
  - The model-facing exec schema continues to expose only auto, sandbox, gateway, and node.
  - compatibilityNativeFallback is never consulted by the governed path.
rollback:
  - Engage runtime.verseShellFoundation.killSwitch to stop governed execution fail-closed.
  - Explicitly restore the selected global, agent, or session tools.exec.host to its prior owner after the stop decision.
  - Do not retry an in-flight or failed VerseShell process through native execution; retained lifecycle records remain terminal or lost evidence.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/uas-06-single-local-exec-canary.md
  - pnpm harness validate --spec harness/specs/tasks/uas-06-single-local-exec-canary.md
  - pnpm run uas:06:real-canary:check
  - pnpm verseshell:test
  - pnpm --dir openclaw_runtime exec vitest run --config test/vitest/vitest.verseshell.config.ts --maxWorkers=1
  - pnpm exec vitest run tests/unit/uas-06-single-local-exec-canary.test.ts --reporter=verbose --maxWorkers=1
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
acceptance:
  - The strict OpenClaw config schema accepts tools.exec.host=verseshell globally and per agent, while the model-facing exec schema does not expose VerseShell.
  - Global, agent, and session cohort selection deterministically resolve eligible local execution to VerseShell without a model decision.
  - The governed route requires verifiedRuntime, typedAci, facade, and governedExec, preserves OpenClaw approval, and has zero implicit native fallback.
  - Short command, long task, background, stdin, PTY, cancellation, timeout, and restart/lost behavior are covered through the existing exec/process facade.
  - Structured diagnostics identify the actual execution host, lifecycle owner, cohort selection, fallback count, duration, outcome, and recovery state without recording command contents.
  - Engineering evidence reports coverage and rollback drills but leaves provider usage, paired task completion, human recovery time, ROI, and soak unqualified until real observations exist.
  - Reviewed live evidence is generated in an independent report from verified diagnostic windows, external provider receipt digests, and human recovery/rollback attestations; it can only make TF-0017 eligible for separate closeout review.
  - UAS-06 cannot close and TF-0018 cannot start until a reviewed real cohort report proves eligible local coverage 100%, native fallback 0, lifecycle success gates, no security veto, and successful kill/rollback drills.
docs:
  required: true
  files:
    - docs/dev/verseshell-foundation/STATUS.md
    - docs/dev/verseshell-foundation/UAS-06-REAL-CANARY-RUNBOOK.md
    - docs/dev/verseshell-foundation/CAPABILITY-AUDIT-AND-IMPLEMENTATION-PLAN.zh-CN.md
    - docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md
    - docs/dev/unified-agent-system/DEVELOPMENT-STRATEGY.zh-CN.md
    - docs/dev/unified-agent-system/CAPABILITY-INTEGRATION-AUDIT-AND-ROADMAP.zh-CN.md
    - docs/dev/Sustained-Development-Playbook.md
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
  notes:
    - Record cohort selection, eligible-local denominator, actual route, hard vetoes, kill/rollback procedure, and evidence qualification.
    - Review README variants under docs-sync; update only when a public configuration, user workflow, or support statement changes.
---

# UAS-06 Single Local Execution Plane Canary

This task implements `TF-0017/UAS-06` only. It turns the UAS-05 governed process lifecycle into a
deterministic, explicitly scoped canary route while preserving the existing `exec` and `process`
tools. `tools.exec.host=verseshell` is an operator-owned global, agent, or session selection; it is
not a model parameter and is not an LLM routing decision.

Engineering readiness and real canary completion are separate gates. Local tests can prove route
selection, lifecycle parity, diagnostics, fail-closed behavior, and rollback mechanics. They cannot
qualify provider usage, paired task completion, human recovery time, security incidence, ROI, or
soak. `TF-0017` remains incomplete until those real cohort fields are reviewed.
