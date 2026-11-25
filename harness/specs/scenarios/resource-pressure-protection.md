---
id: resource-pressure-protection
title: Resource pressure protection and diagnostic opt-out
type: runtime-bridge
ownedPaths:
  - electron/services/efficiency-orchestrator.ts
  - electron/services/resource-fabric.ts
  - electron/services/resource-tracker.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-capacity.ts
  - openclaw_runtime/src/agents/verseshell/managed-process-reservation.ts
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - adaptive-resource-pressure
  - resource-execution-lifecycle
  - resource-bounded-waiting
  - comms-regression
  - docs-sync
---

Inject fresh physical-memory, system-commit or event-loop pressure through the
existing observer. New work contracts its host capacity while active/native/unknown
owners keep their reservations. Recover only after the existing fresh-sample dwell.

Disable efficiency sampling through the typed Settings host API. Diagnostic samples
stop, while the resource observer, power/window listeners and pressure gate continue.
Re-enable recording without creating a second protection observer. Explicit app
shutdown stops both lifetimes and removes their registrations.

Keep a managed idle resource beyond its cleanup age while background work is being
deferred. Bounded heartbeat checks and automatic reclamation still run and retain
the existing observed-resource ownership guard.
