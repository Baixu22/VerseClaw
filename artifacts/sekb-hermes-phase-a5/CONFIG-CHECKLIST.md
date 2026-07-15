# SEKB Hermes — Production Config Checklist (Pass-D1 Hold)

**Purpose:** Verify runtime stays within closed end-state.  
**When:** before any release / env promote / “SEKB on” discussion.  
**Updated:** 2026-07-15T02:42:26Z

## A. Feature flags (must match unless a *new* approved task says otherwise)

| Flag / env | Required for Pass-D1 hold | Notes |
| --- | --- | --- |
| `runtime.contextBlock.sekb.enabled` | **false** (or explicit opt-in only) | Master gate; never force default-on |
| `OPENCLAW_SEKB_ENABLED` | unset or `0`/`false` unless opt-in | Env overrides config when set |
| `runtime.contextBlock.sekb.shadowEvaluation.enabled` | **false** default | Advisory metadata only if enabled |
| `OPENCLAW_SEKB_SHADOW_EVALUATION_ENABLED` | unset/off unless opt-in | |
| `runtime.contextBlock.sekb.batchDistillationAssistant.enabled` | **false** | Explicit invoke only when on |
| `OPENCLAW_SEKB_BATCH_DISTILLATION_ASSISTANT_ENABLED` | unset/off | |
| `runtime.contextBlock.sekb.phaseCWouldTrigger.enabled` | **false** | D1 evidence only; not ambient |
| `OPENCLAW_SEKB_PHASE_C_WOULD_TRIGGER_ENABLED` | unset/off | Kill switch = off |
| Phase D / capture filter flags | **absent / off** | Not authorized by end-state |
| D2 ranking flags | **absent / off** | Not implemented |

## B. Write-path boundaries

| Check | Pass if |
| --- | --- |
| Durable principle write | Only `confirm_and_save` (or existing confirmed human path) |
| Suggest / batch suggest | No principle write before confirm |
| Phase C would_trigger | No trajectory/principle/candidate-pool durable mutation |
| Offline artifacts | Runtime does **not** read `artifacts/sekb-hermes-phase-a5/**` for decisions |

## C. Shadow V1 policy

| Check | Pass if |
| --- | --- |
| Threshold | **50** frozen |
| Holdout retune | **not** performed |
| Policy id | `sekb-shadow-v1-score-gte-50` |

## D. Operator commands (safe)

```bash
# Synthetic lab only (isolated) — does not authorize production on
pnpm sekb:d1:synthetic-observe

# Manual suggest / confirm (durable write only on confirm)
pnpm sekb:hermes:suggest
pnpm sekb:hermes:confirm --suggestion <file>

# Gate tests
pnpm sekb:hermes:gate
```

## E. Quick verify script (read-only)

```bash
node -e "const fs=require('fs');const p='artifacts/sekb-hermes-phase-a5/tier-d/promotion-decision.v1.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));console.log({d1Pass:j.decision.d1Pass,d2:j.decision.d2Authorized,runtimeMut:j.runtimeMutationAuthorized,phaseCD:j.phaseCDActivated,end:j.decision.status});"
```

Expect: `d1Pass=true`, `d2Authorized=false`, `runtimeMutationAuthorized=false`, `phaseCDActivated=false`.

## F. Sign-off box (ops)

```text
[ ] Flags default-off verified in target env
[ ] No Phase D / D2 flags present
[ ] Offline artifacts not wired into runtime
[ ] Messaging matches PUBLIC-MESSAGING.md
Env: ____________  Operator: ____________  Date: ____________
```
