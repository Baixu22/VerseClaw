---
id: runtime-token-savings-v2
title: Runtime Token Savings V2
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Implement native OpenClaw runtime token-saving behavior by combining Runtime Intensity policy, VerseShell-preferred execution, RTK-style local output reducers, Caveman-style safe prose compression, and Ponytail-style low/medium skill strategy without copying external code.
touchedAreas:
  - harness/specs/tasks/runtime-token-savings-v2.md
  - docs/superpowers/specs/2026-07-06-runtime-token-savings-v2-design.md
  - openclaw_runtime/src/agents/intensity-policy.ts
  - openclaw_runtime/src/agents/verseshell-runtime.ts
  - openclaw_runtime/src/agents/bash-tools.exec*.ts
  - openclaw_runtime/src/agents/exec-defaults.ts
  - openclaw_runtime/src/agents/embedded-agent-runner/**
  - openclaw_runtime/src/agents/system-prompt-report.ts
  - openclaw_runtime/src/config/types.tools.ts
  - openclaw_runtime/src/config/zod-schema.agent-runtime.ts
  - openclaw_runtime/src/context-engine/types.ts
  - openclaw_runtime/src/skills/loading/workspace.ts
  - resources/verseshell-mcp/src/index.js
  - tests/unit/runtime-token-savings-*.test.ts
  - tests/fixtures/runtime-token-savings/**
expectedUserBehavior:
  - Minimal and low runs spend materially less context on skill prompts and tool/shell outputs while preserving recovery.
  - Medium runs apply conservative savings and Ponytail-style skill/component selection without losing normal capability awareness.
  - High, xhigh, and max runs preserve full runtime capability and do not compact away useful context.
  - Explicit prompt mode, raw model runs, and explicit exec host choices keep their existing meaning.
  - VerseShell is preferred only when eligible and configured by policy; fallback and approvals stay observable and safe.
  - Compact shell/tool output keeps failure evidence, paths, exit codes, and raw recovery pointers.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - docs-sync
acceptance:
  - A typed runtime token savings policy is the single source for shell preference, output reducer mode, prose compression mode, skill strategy, recovery, and metrics.
  - Runtime consumers receive policy objects and do not reparse raw thinkLevel.
  - Explicit promptMode, promptMode none, modelRun true, and explicit exec host values are preserved.
  - VerseShell is accepted consistently by config types, Zod schema, session patching, directive validation, and runtime host resolution.
  - VerseShell preference is live for eligible local shell/process calls at minimal, low, and medium unless an explicit host or unavailable VerseShell prevents it.
  - VerseShell fallback does not bypass approvals, security policy, or existing host constraints.
  - RTK-style reducers are implemented locally; no external RTK binary or source code is required.
  - Reducers preserve exit code, failure status, key stderr, file paths, line numbers, and first meaningful error evidence.
  - Reducers attach a raw recovery pointer for truncated output and for failing compacted output when raw output exists.
  - Caveman-style prose compression is deterministic and protects code blocks, inline code, paths, commands, URLs, numbers, versions, env vars, diagnostics, and table structure.
  - Ponytail-style strategy affects low and medium skill prompt rendering and component-selection guidance.
  - Skill prompt limits are transient and do not mutate skill registry entries, persisted snapshots, or loaded skill state.
  - Reports contain structured savings metadata and no raw system prompt, raw skill prompt, raw tool output, or raw shell output.
  - Quantitative fixture benchmark reports before/after chars, estimated saved tokens, reducer family, and recovery pointer presence.
  - Runtime Intensity V1 tests remain green after V2 changes.
subagents:
  - name: policy-contract-review
    purpose: Verify policy mapping, preservation semantics, and no raw thinkLevel reparsing.
  - name: verseshell-host-review
    purpose: Verify VerseShell host selection, schema consistency, fallback behavior, and approval boundaries.
  - name: output-reducer-review
    purpose: Verify reducers preserve diagnostics, attach recovery pointers, and produce measured savings.
  - name: skill-strategy-review
    purpose: Verify Ponytail low/medium behavior and transient skill prompt limits.
  - name: privacy-metrics-review
    purpose: Verify reports and metrics are structured and do not leak raw prompt or output text.
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/runtime-token-savings-v2.md
  - pnpm harness validate --spec harness/specs/tasks/runtime-token-savings-v2.md
  - pnpm exec vitest run tests/unit/runtime-token-savings-*.test.ts --reporter=verbose
  - pnpm exec vitest run tests/unit/runtime-intensity-*.test.ts --reporter=verbose
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
  - git diff --check
docs:
  required: true
  files:
    - docs/superpowers/specs/2026-07-06-runtime-token-savings-v2-design.md
---

## Implementation Notes

Start from a clean dedicated branch or worktree, preferably
`codex/runtime-token-savings-v2`. Do not mix this feature with the dirty
Runtime Knowledge/SEKB UX work currently present on `codex/sekb-runtime-knowledge`.

Runtime Intensity V1 can be used as a starting point, but V2 is broader. It must
deliver live VerseShell preference, local output reducers, raw recovery pointers,
safe prose compression, low/medium Ponytail-style skill strategy, and measured
before/after savings.

RTK, Caveman, and Ponytail are design references only. Do not copy their source
code, ship their binaries, or make runtime behavior depend on them.
