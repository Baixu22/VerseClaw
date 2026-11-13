---
lifecycleStatus: active
id: g4-windows-product-recovery
title: Restore Windows product startup and cancellation recovery
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 5418cb1fe8b35c61b7a15021b999e800b509055a
intent: Keep the Windows matrix on its qualified Electron host and preserve cancellation finality so the same session can send its next turn.
requiredRules:
  - backend-communication-boundary
  - chat-stream-publication
  - comms-regression
  - docs-sync
  - repository-artifact-retention
touchedAreas:
  - src/stores/chat.ts
  - tests/unit/chat-stream-publication.test.ts
  - tests/e2e/product-acceptance-space-bunny.spec.ts
  - tests/e2e/chat-new-session-date.spec.ts
  - tests/e2e/fixtures/electron-executable.d.mts
  - scripts/rc10/driver.mjs
  - scripts/rc10/operator-driver.mjs
  - harness/specs/fixtures/product-acceptance-matrix/inventory.json
  - harness/specs/rules/chat-stream-publication.md
  - harness/specs/scenarios/gateway-backend-communication.md
  - harness/specs/tasks/g4-windows-product-recovery.md
  - harness/specs/fixtures/g4-windows-relay/**
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - After a confirmed cancellation, delayed text, tool and final frames retain the aborted run and leave the composer ready for another message.
  - Delayed cancelled-run frames cannot replace the next turn or initiate a history reload for it.
requiredProfiles:
  - fast
  - comms
requiredTests:
  - node node_modules/vitest/vitest.mjs run tests/unit/chat-stream-publication.test.ts tests/unit/chat-runtime-sequence.test.ts tests/unit/r0-3-chat-abort-checkstuck.test.ts --maxWorkers=1
  - pnpm exec playwright test tests/e2e/product-acceptance-space-bunny.spec.ts --workers=1
  - pnpm run typecheck
  - pnpm run typecheck:test
  - pnpm run comms:replay
  - pnpm run comms:compare
  - pnpm harness validate --spec harness/specs/tasks/g4-windows-product-recovery.md
  - pnpm harness run --spec harness/specs/tasks/g4-windows-product-recovery.md --dry-run
  - git diff --check
acceptance:
  - The regression fails on the base candidate when legacy tool and text finals mutate an aborted run's messages.
  - All legacy frames from an aborted runtime owner are ignored before adopting a run or refreshing history, both before and during the next turn.
  - Completed runs still deliver their final message, and a failed abort still retains running ownership.
  - Windows product cancellation resumes the same session and retains the existing delayed-frame and no-effect assertions in three independent profiles.
  - The recovery fixture activates the existing Resume control, verifies the draft is ready, and then sends it through the same composer.
  - RC-10 drivers use the same explicit E2E Electron executable selection as the shared fixture while retaining their launch and business budgets.
  - Session-order assertions target sidebar rows and retain the complete four-label ordering oracle.
  - Final evidence records the clean candidate, source/build binding, commands and receipts; diagnostic failures retain their original results.
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
---

This repair advances G4 and TF-0582 through the existing product matrix. The
matrix inventory, frozen case assertions and provider timeout settings remain
the acceptance inputs. Raw runs are retained outside the checkout on D:.
