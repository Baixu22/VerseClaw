---
lifecycleStatus: active
id: electron-main-blocking-io
title: Electron main blocking I/O for TF-0419
type: task
intent: Remove synchronous manifest reads and prelaunch maintenance from the first-frame path, and ensure Gateway/config-sync work starts only after ready-to-show while preserving security and atomic-write behavior.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - electron/main/index.ts
  - electron/extensions/loader.ts
  - harness/specs/tasks/electron-main-blocking-io.md
  - harness/specs/fixtures/tf0419-main-blocking-io/**
---

# TF-0419 Main Blocking I/O

## Objective

Keep first-frame work free of synchronous extension-manifest reads, launch-at-
startup maintenance, and Gateway/config-sync startup work, while retaining the
required proxy and WebView security ordering and the existing atomic-write
semantics elsewhere.

## Acceptance

- The extension manifest is read through asynchronous `readFile`, not
  `readFileSync`, before extension registration.
- Launch-at-startup synchronization runs after the window's first paint.
- Gateway auto-start, including config-sync Docker probes, runs after
  ready-to-show; the `gateway-start` performance mark is available for proof.
- Startup before/after marks and five independent runs are retained.
- Relevant Electron E2E and project gates pass.
