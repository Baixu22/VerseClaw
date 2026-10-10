---
lifecycleStatus: archived
id: cvk-real-runtime-evidence
title: Record real runtime evidence that the CVK prompt addition reaches and is consumed by the live model
type: task
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: 709d4350d7005c609e75a12e1aa8be5a18209a12
intent: Sink real evidence (no new product code) that the Context Runtime Kit prompt addition is actually injected into a real isolated Gateway request and consumed by the supplied step-5-preview.
scenarios:
  - gateway-backend-communication
requiredRules:
  - backend-communication-boundary
  - repository-artifact-retention
requiredProfiles:
  - fast
  - comms
touchedAreas:
  - docs/dev/cvk-real-runtime-evidence-20261009.md
  - artifacts/cvk-real-runtime-evidence-20261009/**
  - .gitignore
  - scripts/repository-artifacts.json
  - harness/specs/tasks/cvk-real-runtime-evidence.md
expectedUserBehavior:
  - With runtime.contextRuntimeKit.enabled=true the real model request carries the [Context Runtime Kit] block, and the real model answers from it.
docs:
  required: true
  paths:
    - docs/dev/cvk-real-runtime-evidence-20261009.md
requiredTests:
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - A byte-exact loopback capture of the real upstream provider request shows the [Context Runtime Kit] block, artifact hash, SC/RRR/AR metrics, and tool gate mode.
  - The real step-5-preview returns the injected tool gate mode, proving consumption rather than mere presence.
  - The driver script stays outside the repository; only curated report, credential scan, and hashes land, and the exact provided credential is absent.
  - The tool gate remains report_only; no product default, permission, or lock is changed, and no desktop, installer, platform, or GA scope is claimed.
---

This task records real runtime evidence only; it does not implement or promote CVK.
The simulator that drives the chat turn is kept off-repo by owner request.
