---
lifecycleStatus: active
id: component-graduation-report-v1
title: Component graduation report schema and automatic gate
taskType: governance
intent: Define ComponentGraduationReport/v1, validate disposition-specific evidence from hashed raw artifacts, and fail closed when an invalid report or default change is used to close a component or Task Forest node.
touchedAreas:
  - shared/component-graduation-report.ts
  - shared/component-authority-manifest.ts
  - scripts/component-graduation-report.mts
  - harness/specs/tasks/component-graduation-report-v1.md
  - harness/specs/fixtures/component-graduation-report/**
  - tests/unit/component-graduation-report.test.ts
  - tests/unit/component-authority-manifest.test.ts
expectedUserBehavior:
  - Component completion is described by a machine-readable report rather than a free-form green claim.
  - Internal, retired and default/advanced components use distinct evidence requirements.
  - Shadow and experiment reports remain visible but never count as graduated.
requiredProfiles:
  - fast
requiredTests:
  - tests/unit/component-graduation-report.test.ts
acceptance:
  - The report exposes componentId, disposition, maturity, owner, entryPoint, defaultMode, benefitEvidence, rollback, modelEffectiveState, evidenceGrade, actor/driven_by and expiry.
  - Default/advanced, internal, retired, experiment/shadow and administrative/contract reports require their declared evidence classes.
  - Artifact, hash, source/build freshness, scope, actor, model, raw-result and recompute mismatches fail validation.
  - Task Forest done requires a matching passing report; experiment/shadow reports cannot close a done node.
  - A default-mode change is rejected unless the report is default/advanced, valid and complete.
docs:
  required: false
---

## Scope

This spec governs the structural component-graduation gate. It does not change runtime behavior, product defaults or product locks. It provides a validator shared by the CLI and unit tests, plus positive/negative fixtures.

## Evidence boundary

Synthetic fixtures prove the validator only. They are `driven_by: agent`, never real-human evidence, and do not support product promotion or a live default flip.