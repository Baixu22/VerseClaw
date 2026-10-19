---
lifecycleStatus: active
id: versebrowser-deferred-scope
title: VerseBrowser deferred enhancement and driver scope for TF-0343/TF-0344
scenario: context-family
taskType: planning
intent: Preserve the two VerseBrowser deferred scope nodes as a machine-readable registry with explicit activation gates, while keeping every listed enhancement unimplemented until a real task, minimal reproduction and independent verdict justify a separate task.
requiredProfiles:
  - fast
requiredRules:
  - workspace-harness-single-source
  - task-forest-autoclose-and-roles
expectedUserBehavior:
  - Current browser workflows continue using the landed Playwright/CDP/Electron paths.
  - Deferred visual-coordinate, extra-driver, advanced-network, replay, trace, site-native and remote-browser capabilities are not advertised as complete.
  - Reopening any item requires a named real task, reproduction and independent acceptance; a new driver requires its own acceptance.
touchedAreas:
  - harness/specs/tasks/versebrowser-deferred-scope.md
  - harness/specs/fixtures/tf0343-tf0344-deferred-scope/**
  - tests/unit/versebrowser-deferred-scope.test.ts
requiredTests:
  - tests/unit/versebrowser-deferred-scope.test.ts
acceptance:
  - Every deferred item has a single owner task, current disposition, trigger, activation gate and evidence anchor.
  - No deferred item is marked implemented or accepted in this cycle.
  - Cloud scheduling, generic planners, stealth/proxy platforms and CAPTCHA bypass remain excluded.
  - Existing Playwright/CDP/host interfaces remain the first choice; any additional driver has its own acceptance.
docs:
  required: false
---

# TF-0343/TF-0344 Deferred Scope Registry

These nodes preserve future enhancement triggers; they do not implement the
enhancements. A deferred item stays non-delivered until a separate task supplies
the named real workflow, minimal reproduction, independent verdict and, for a
new driver, its own host acceptance.

## Activation Rule

An item may move out of deferred state only when all are true:

1. A named real task or integration exists.
2. A minimal reproduction demonstrates the current path cannot serve it.
3. Existing Playwright/CDP/host interfaces have been ruled out or shown
   insufficient.
4. The item has its own acceptance criteria and rollback path.
5. Any new driver or host target gets a separate acceptance rather than
   extrapolating from the existing matrix.

The registry in `harness/specs/fixtures/tf0343-tf0344-deferred-scope/registry.json`
is the authoritative machine-readable inventory.
