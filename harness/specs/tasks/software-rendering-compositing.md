---
lifecycleStatus: active
id: software-rendering-compositing
title: Software-rendering layer and backdrop audit for TF-0420
type: task
intent: Audit backdrop filters and will-change hints under GPU-disabled Electron, remove unjustified persistent layer hints, and retain design-critical blur only when the A/B probe shows no consistent CPU/frame benefit.
scenarios:
  - identity-scope-compatibility
requiredRules:
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
touchedAreas:
  - src/styles/codex-welcome-hero.css
  - src/styles/codex-sidebar.css
  - src/components/chat/ChatAgentEffortPopover.tsx
  - harness/specs/tasks/software-rendering-compositing.md
  - harness/specs/fixtures/tf0420-software-rendering/**
---

# TF-0420 Software-Rendering Compositing

## Objective

Keep the resting ClawX shell usable under GPU-disabled Electron without carrying
unnecessary persistent compositor hints. The audit distinguishes short-lived
menus/dialogs from resting composer/sidebar/settings surfaces and records an
A/B with backdrop filters and will-change removed at runtime.

## Acceptance

- Every `backdrop-filter` and `will-change` occurrence is listed and classified
  as short-lived, persistent/justified, or removed.
- The three unjustified persistent will-change hints are removed without
  changing animation, focus, reduced-motion, or layout behavior.
- Composer, sidebar, session-search dialog and settings are exercised under
  GPU-disabled Electron; frame timing, long-task counts, RSS/sampler data and
  screenshots are retained.
- The A/B does not justify removing design-critical backdrop filters; retained
  filters are explicitly documented.
- Relevant E2E, typecheck, build, harness and agent-dev gates pass.
