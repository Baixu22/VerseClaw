---
id: fix-coding-tool-workspace-boundary
title: Align coding mutation tools on the configured workspace boundary
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Remove the surprising default mismatch between write, edit, apply_patch, and undo_write while preserving explicit workspace confinement and safe handling of persisted journal entries.
touchedAreas:
  - harness/specs/tasks/fix-coding-tool-workspace-boundary.md
  - openclaw_runtime/src/agents/agent-tools.ts
  - openclaw_runtime/src/agents/tools/write-journal.ts
  - openclaw_runtime/src/agents/**/*.test.ts
  - openclaw_runtime/src/config/types.tools.ts
  - openclaw_runtime/src/config/schema.help.ts
  - openclaw_runtime/docs/.generated/config-baseline.sha256
expectedUserBehavior:
  - With no workspace-only setting, write, edit, apply_patch, and undo_write can operate on an explicitly supplied path outside the agent workspace.
  - tools.fs.workspaceOnly=true confines write, edit, apply_patch, and undo_write to the agent workspace.
  - tools.exec.applyPatch.workspaceOnly=true can apply a narrower boundary to apply_patch without changing the other filesystem tools.
  - tools.exec.applyPatch.workspaceOnly=false cannot weaken tools.fs.workspaceOnly=true.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - docs-sync
  - coding-mutation-consistency-boundary
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/fix-coding-tool-workspace-boundary.md
  - pnpm harness validate --spec harness/specs/tasks/fix-coding-tool-workspace-boundary.md
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-core.config.ts src/agents/agent-tools.workspace-boundary.test.ts
  - pnpm --dir openclaw_runtime exec node scripts/run-vitest.mjs run --config test/vitest/vitest.agents-tools.config.ts src/agents/tools/write-journal.test.ts
  - pnpm --dir openclaw_runtime config:docs:check
  - pnpm --dir openclaw_runtime tsgo:core
  - pnpm --dir openclaw_runtime tsgo:core:test
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - The unset apply_patch workspace boundary inherits the effective tools.fs.workspaceOnly policy instead of imposing a contradictory secure-by-default override.
  - An explicit apply_patch-only workspace boundary remains supported, while the filesystem umbrella policy always wins when it is enabled.
  - undo_write refuses to restore or delete an out-of-workspace target when the current filesystem policy is workspace-only, including entries rehydrated from an older journal.
  - A refused undo leaves the journal entry and snapshot intact for later recovery under an authorized policy.
  - Focused runtime tests cover the default unrestricted path, the umbrella restriction, the apply_patch-only restriction, and undo behavior for persisted outside-workspace entries.
docs:
  required: false
  note: No renderer flow changes. Update the inline config type and schema help so the effective default and precedence are explicit; README variants contain no matching public configuration guidance.
---
