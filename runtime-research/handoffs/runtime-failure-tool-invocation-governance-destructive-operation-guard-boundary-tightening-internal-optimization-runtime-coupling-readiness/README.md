# Destructive Operation Guard Boundary Tightening Internal Optimization Runtime Coupling Readiness

Status: readiness_design_internal_optimization_not_production_ready.

## Scope

This package records the next `destructive_operation_guard` phase after the internal evaluation scorecard.

The phase is limited to:

- offline boundary tightening
- sanitized transcript parser and sanitizer hardening
- observation-only shadow summaries
- real-data feedback scoring explanation
- runtime coupling readiness design

It does not connect to UI, Gateway, TaskLoop decisions, provider transport, prompt/model-message assembly, retry, approval, rollback, completion, checkpoint/lifecycle authority state, Electron services, renderer code, scripts, services, daemons, listeners, databases, exporters, or schedulers.

## Current Baseline

- Internal score: 93/100.
- Decision: `continue_with_separate_accepted_spec`.
- Hard veto: none.
- Real-data feedback quality: 8/15 warning.
- Current real-data weakness: local transcript records were present, but tool invocation and candidate metadata were missing.

## Added Evidence

The scorecard helper remains diagnostics-only and now also records:

- stronger leak classes for raw prompt/provider/tool/stdout/stderr content, env-like values, secrets, and Windows/POSIX paths
- transcript metadata counters for usage metadata present vs missing
- parser coverage for malformed JSONL, unknown tools, `code_mode_exec`, candidate metadata, and partial signals
- observation-only shadow summaries with `activeDecision: false`
- real-data scoring explanations with a next-round 12+/15 target
- runtime coupling readiness reports that only allow future mutation-capable tool invocation preflight ownership

## Stop Line

This package does not approve production/default-on behavior, default blocking, active owner expansion, or any new runtime consumer.

