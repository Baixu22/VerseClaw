# Controlled Opt-in Plan

## Goal

Phase C designs internal-only, developer-only, controlled opt-in for the explicit TaskLoop pilot. It remains non-default production behavior.

## Entry Criteria

- Phase A Replay Proof accepted.
- Phase B Cutover Readiness Review accepted.
- No veto gate is open.
- Operator rollback and diagnostics are documented.

## Internal Opt-in Strategy

| Gate | Requirement |
|---|---|
| Internal-only | hidden from normal users and production defaults |
| Developer-only | requires developer/operator configuration authority |
| Per-agent | opt-in scoped to a named agent |
| Per-session | opt-in scoped to a single session or run |
| Allowlist workspace | only explicitly listed workspaces may opt in |
| Explicit invocation | caller still must request the TaskLoop pilot |
| Explicit AgentMapResult | result must be supplied and valid |

## Config Gate Plan

The future implementation, if approved by a separate spec, must require all existing gates plus internal opt-in metadata:

- `runtime.agentMap.promptAssemblyExperiment`
- `runtime.agentMap.promptCandidateRuntimeShadow`
- `runtime.agentMap.promptCandidateControlledCutoverPilot`
- `runtime.agentMap.promptCandidateTaskLoopExplicitInvocationPilot`
- internal developer opt-in flag
- per-agent allow entry
- per-session allow entry
- workspace allowlist match

Omitting any gate must restore legacy byte parity.

## Operator Diagnostics

Diagnostics must report:

- gate state and which gate blocked insertion;
- explicit invocation state;
- AgentMapResult validity;
- candidate status and token budget;
- prompt-present exclusion count;
- no-persistence assertion;
- provider ordering snapshot status;
- rollback readiness.

Diagnostics must not persist candidate text.

## Failure Reporting

Failures must be categorized as:

- gate disabled;
- invocation not requested;
- invalid AgentMapResult;
- candidate empty;
- candidate budget exhausted;
- prompt-present file excluded;
- leakage scan failed;
- provider ordering drift;
- default prompt drift;
- rollback parity failed.

## Rollback Path

Rollback requires one of:

- disable any existing AgentMap prompt candidate gate;
- remove the per-session opt-in;
- remove the per-agent opt-in;
- remove the workspace allowlist entry;
- omit explicit invocation;
- omit the explicit AgentMapResult.

No candidate/replay cleanup is required because output must not persist.

## Acceptance Thresholds

- Candidate leakage: 0.
- Default reviewer prompt drift: 0.
- Provider ordering drift: 0.
- Default runtime behavior drift: 0.
- Rollback success: 100%.
- Failure paths fail closed: 100%.
- Operator diagnostic coverage: at least 95% of required failure categories.

## Exit Criteria

Controlled internal opt-in may move to Limited Production Opt-in planning only after internal opt-in evidence demonstrates the thresholds above across representative internal runs.

## Limited Production Opt-in

Phase D is allowed only after Phase A and Phase B are accepted and Phase C evidence meets thresholds.

### Allowed Scope

- allowlisted production workspace only;
- allowlisted agent only;
- allowlisted session/run only;
- explicit invocation only;
- explicit valid `AgentMapResult` only;
- no default-on behavior;
- no provider ordering changes;
- no candidate/replay persistence.

### Blocked Scope

- all normal users by default;
- all non-allowlisted workspaces;
- all non-allowlisted agents/sessions;
- any Gateway/provider/model transport route;
- any automatic discovery/cache/reuse;
- any runtime authority path;
- any production default or default cutover path.

### Diagnostic Observability

Limited production opt-in must expose operator-safe, candidate-text-free diagnostics:

- opt-in scope identifiers;
- gate state;
- insertion status;
- failure category;
- leakage scan result;
- rollback readiness;
- provider ordering snapshot result;
- default prompt drift result.

### Rollback Criteria

Rollback is mandatory when:

- candidate leakage is greater than 0;
- default reviewer prompt drift is greater than 0;
- provider ordering drift is greater than 0;
- default runtime behavior drift is greater than 0;
- any gate cannot restore legacy parity;
- candidate/replay output is persisted;
- automatic discovery/cache/reuse appears;
- AgentMap gains runtime/tool/security/approval/retry/completion/provider/model/Gateway authority.

### Incident/Veto Criteria

Any veto gate firing moves the feature back to default-off diagnostics-only and blocks further production expansion until a new synthesis accepts the fix.

## Default-on Proposal Prerequisites

Phase E is proposal-only. It does not implement or approve default-on.

Before a default-on proposal can be written:

- Replay sample size must cover at least 100 representative TaskLoop runs or an owner-approved equivalent corpus.
- Leakage zero threshold must hold across all replay and opt-in runs.
- Drift zero threshold must hold for reviewer prompt bytes, provider ordering, and default runtime behavior.
- Rollback proof threshold must be 100% per gate.
- Operator readiness threshold must include documented diagnostics, rollback, incident handling, and ownership.
- Any UI/config exposure must include docs, i18n coverage, and Electron E2E coverage.
- A separate task spec and synthesis must explicitly reject or approve each production default behavior change.
