---
id: fix-file-transfer-tool-availability
title: Hide unconfigured paired-node file-transfer tools from single-machine agents
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Prevent agents from selecting paired-node file-transfer tools that are guaranteed to fail in default single-machine sessions while preserving explicitly configured remote-node workflows.
touchedAreas:
  - harness/specs/tasks/fix-file-transfer-tool-availability.md
  - openclaw_runtime/extensions/file-transfer/**
expectedUserBehavior:
  - Default single-machine sessions do not expose file_fetch, dir_list, dir_fetch, or file_write when paired-node command and path policies are not configured.
  - Local workspace discovery continues through read and ls instead of paired-node transfer tools.
  - Explicitly configured paired-node read policies expose only the read-side transfer tools whose node commands are allowed.
  - Explicitly configured paired-node write policies expose file_write only when its node command is allowed.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/fix-file-transfer-tool-availability.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.extensions.config.ts extensions/file-transfer/index.test.ts
  - pnpm --dir openclaw_runtime tsgo:extensions
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Tool publication is fail-closed when the file-transfer plugin has no configured node policy.
  - Read-side tools require both an effective gateway command allow and a configured allow-or-ask read policy.
  - The write-side tool requires both an effective gateway command allow and a configured allow-or-ask write policy.
  - gateway.nodes.denyCommands overrides allowCommands for tool publication.
  - Runtime execution retains its existing paired-node lookup and node-side path enforcement.
docs:
  required: false
  note: The change narrows model-facing tool publication; existing manifest and tool descriptions already document the paired-node-only contract.
---

