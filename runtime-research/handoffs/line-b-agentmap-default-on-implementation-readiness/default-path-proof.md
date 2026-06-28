# Default Path Proof

## Default-Off Legacy Parity

Default path means omitted/off AgentMap flags, no explicit invocation, missing/invalid/malformed AgentMapResult, prompt-present exclusion, or exhausted budget. Every default path must return the original reviewer prompt bytes.

## Current Proof Shape

The implementation-readiness corpus includes:

- all 81 omitted/off/on combinations for the four AgentMap prompt-candidate flags,
- `explicitInvocation` true and false,
- valid, invalid, missing, and malformed AgentMapResult cases,
- normal, near-limit, and exhausted budgets,
- prompt-present true and false,
- long-context, multi-file, failed-task, blocked-task, provider-ordering-sensitive, and checkpoint/lifecycle-sensitive cases.

Expected corpus size: 225 cases. Required default reviewer prompt byte drift: 0.
