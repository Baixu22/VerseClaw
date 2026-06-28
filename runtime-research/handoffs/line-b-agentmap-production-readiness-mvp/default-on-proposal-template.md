# Default-on Proposal Template MVP

Default-on is future-only. This Phase B package cannot approve default-on behavior or default cutover.

## Required Future Package

- New task spec dedicated to default-on proposal.
- New synthesis dedicated to default-on proposal.
- Separate validation run.
- Expanded replay corpus and internal opt-in evidence.
- Provider ordering proof.
- Default reviewer prompt byte proof.
- Candidate leakage proof.
- Persistence proof.
- Rollback proof.
- Security authority proof.
- Operator sign-off.

## Blocking Conditions

- Any default prompt/reviewer prompt byte drift.
- Candidate text in default prompts, model messages, Gateway, provider transport, checkpoint, or lifecycle payloads.
- Provider ordering drift.
- Candidate/shadow/replay persistence.
- AgentMap authority escalation.
- Automatic AgentMapResult discovery/build/cache/reuse.
- Missing rollback evidence.
- Missing comms replay/compare if communication paths are touched.

## Current Phase Decision

Default-on and default cutover are not allowed in this phase.
