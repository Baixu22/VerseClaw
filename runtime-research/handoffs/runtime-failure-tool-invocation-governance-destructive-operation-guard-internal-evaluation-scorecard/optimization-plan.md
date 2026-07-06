# Optimization Plan

Status: internal_hardening_plan.

## Recommendations

1. Expand sanitized real-data sampling.
   - Current local scan found transcript records but no tool invocation or preflight candidate metadata.
   - Next evaluation should run on a host/session set with code-mode tool activity.

2. Add observation-only shadow summaries in a separate accepted spec.
   - Keep active behavior default-off.
   - Record only bounded sanitized counts and decision categories.

3. Keep false-block corpus mandatory.
   - Expected deletion, slow test command, and known dev-server-like long-running metadata remain the highest-value false-block sentinels.

4. Keep denied-root boundary scans in every continuation gate.
   - Any TaskLoop, provider, Gateway, prompt, retry, approval, rollback, completion, checkpoint, lifecycle, Electron, renderer, or script consumer remains a hard veto.

5. Preserve rollback proof.
   - Omitted or false `runtime.toolGovernance.destructiveOperationGuard.preflight.enabled` must continue to restore legacy allow behavior with no migration or cleanup.

## Not Recommended

- Do not turn the guard on by default.
- Do not broaden ownership outside mutation-capable tool invocation preflight.
- Do not use raw transcripts, prompts, tool arguments, tool results, stdout/stderr, environment dumps, or workspace content as scorecard output.
- Do not treat this score as production readiness.
