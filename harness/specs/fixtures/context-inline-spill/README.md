# Inline/Spill recall retention evidence

This directory retains the final agent-driven four-arm evaluation and clean-candidate gate records.

- Candidate: `16da6fdf22b0bda023becffa4272373be610ab54`
- Current summary: `result-summary.json`
- Raw model-visible inputs, responses, JSONL and archive recovery: `retention-final/deterministic/` and `retention-final/live/`
- Commands, exit codes and logs: `retention-final/gates/`
- Frozen legacy parity fixture: `off-mode-baseline.json`
- Historical visibility-level summary: `visibility-only-summary.json`
- Provider: local OpenAI-compatible Responses, requested model `space-bunny`; one request per arm.
- Scoped completion checks follow the original owner handoff and `scoped-development-validation`.
- Additional full Harness/CI failures are retained separately with their original candidate identity; they are not claimed as passing.
- Structured review uses Codex CLI with the owner-supplied `space-bunny` provider; routing metadata is retained.
- No autonomous model recall selection, full agent loop, billing estimate, formal two-role acceptance, default graduation or release approval is claimed.

The successful structured review covers final commit `16da6fdf22b0bda023becffa4272373be610ab54` with supplied source context. Whole-branch attempts did not produce a usable verdict.
