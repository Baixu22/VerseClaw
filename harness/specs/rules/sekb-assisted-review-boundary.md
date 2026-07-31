---
id: sekb-assisted-review-boundary
title: SEKB Assisted Review Boundary
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
severity: error
---

# Rule: SEKB assisted review remains human-confirmed

## R1: Suggestions are mutation-free

Opening Runtime Lessons, loading reports, requesting deterministic suggestions, selecting a candidate, and editing review fields must not write a principle, ContextBlock, index entry, trajectory state, or wiki page. `confirm_and_save` remains the only durable L2 principle write path.

## R2: Confirmation is exact and explicit

The user must review one exact suggestion and provide visible session lineage before confirm is enabled. Renderer sends the reviewed suggestion through the typed host API with `sourceSystem: "ui-confirm"` and `integrityClaim: "confirmed"`. Main remains responsible for provenance and durable writes.

## R3: Reject cannot promote

Reject may call only the existing SEKB rejection action. It must not call confirm, wiki apply, ContextBlock write, or a hidden retry. The current review queue may remove the rejected candidate after Main acknowledges the rejection.

## R4: Retrieval is advisory

Retrieval reads only active confirmed principles and displays the bounded returned injection text. The UI must not automatically attach it to a conversation, enable runtime injection, or claim that retrieval proves adoption or product benefit.

## R5: Default-off remains authoritative

The UI must not enable SEKB master, shadow, batch assistant, phase-C, capture, or injection flags. Runtime unavailable and empty states remain explicit and do not trigger fallback writes or hidden model calls.

## R6: Evidence remains honest

Fixture and Electron E2E evidence may prove the typed workflow only. It must not be represented as human usage, real-provider batch distillation, live retrieval benefit, product approval, default-on readiness, or GA evidence.

## Validation

- `pnpm harness validate --spec harness/specs/tasks/sekb-assisted-ui-component-graduation.md --since HEAD`
- focused Knowledge page and Knowledge API unit tests
- Electron E2E for suggest, review, confirm, retrieve, and reject
- `pnpm contract:check`
- `pnpm run comms:replay`
- `pnpm run comms:compare`
