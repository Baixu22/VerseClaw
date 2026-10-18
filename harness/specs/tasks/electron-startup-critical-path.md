---
lifecycleStatus: active
id: electron-startup-critical-path
title: Electron startup critical path for TF-0418
type: task
intent: Move menu, tray, telemetry, and extension initialization off the serial pre-ready path while preserving security, menu, Gateway, and extension smoke behavior.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - electron/main/index.ts
  - harness/specs/tasks/electron-startup-critical-path.md
  - harness/specs/fixtures/tf0418-startup/**
---

# TF-0418 Startup Critical Path

## Objective

Reduce serial work between app readiness and the main window's first usable
frame without weakening the WebView/proxy/security ordering or breaking native
menus, tray, settings, Gateway, or extension initialization.

## Acceptance

- `createMenu`, `createTray`, `initTelemetry`, and `extensionRegistry.initialize`
  are no longer awaited in the pre-window critical path.
- Five independent startup runs produce before/after marks for app-ready,
  window-created, ready-to-show, and renderer-first-paint.
- `ready-to-show` P50 improves and P95 does not regress against the captured
  baseline, or the node remains open with the reason.
- Native menu, Settings storage, and Gateway lifecycle Electron E2E smoke pass.
- All evidence is agent-driven and local-only.
