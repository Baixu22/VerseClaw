# Security Policy

Verse Claw is a **private, pre-release alpha** desktop application. This policy
states the support scope and the reporting path that actually exist in this
repository. It deliberately promises no response time, no disclosure calendar, no
bug bounty and no security certification. Where a guarantee does not exist, this
document says so instead of implying one.

Machine check: `pnpm docs:policy:validate` fails if this file drifts back toward
template text, if the supported-version scope stops matching `package.json`, or
if any repository path referenced here disappears. Both checks are driven by
`scripts/validate-policy-docs.mjs`.

## Supported versions

| Version | Security fixes |
| ------- | -------------- |
| `main` (current tip; package version `0.4.9-alpha.0`) | Yes — a fix is provided for the tip of `main` once it is implemented, tested and recorded |
| Any other branch, fork, local build or older alpha artifact | No — there is no back-port branch and no maintenance commitment |

Only the tip of `main` is maintained. There is no long-term-support line, no
back-port promise, and no committed fix window. The authoritative current
version is the `version` field of `package.json`; a fix for one alpha does not
imply a fix for any earlier alpha. When the version changes, the version named in
this table must change in the same commit or the validation above fails.

Platform scope follows the project's own status statement: controlled
**Windows x64** workflows are the primary local acceptance target; macOS and
Linux have build targets but are not continuously verified. A platform that is
not continuously verified is not a supported security platform.

## Reporting a vulnerability

1. **Open an issue in this repository** (`Baixu22/VerseClaw`). The repository is
   private, so a report is already non-public: only accounts with repository
   access can read it.
2. **Do not include live credentials, provider API keys, gateway tokens, user
   chat transcripts, private file contents or third-party personal data.** Use
   synthetic markers instead, for example `<SYNTHETIC_TOKEN>` or
   `sk-AUDIT_SYNTHETIC`.
3. **If a real credential may already have leaked, rotate it first** and then
   report. Do not send a recovered secret to prove the finding.
4. GitHub's *Private vulnerability reporting* feature is **not enabled** for this
   repository today, so an issue is the working path. If it is enabled later,
   prefer that channel; this document will be updated in the same change.
5. A report does not need a proof of concept against a real account. A committed
   source path plus a synthetic reproduction is enough to start triage.

A useful report names: the affected path and commit, the precondition (for
example "requires an approved host command" or "requires a configured provider"),
the observable impact, the evidence level (source read, unit test, live local
run), and what was **not** verified. Overclaiming is treated as a defect in the
report, not as severity.

## Triage and tracking

Priority labels reuse the repository's existing issue convention: **P0**
release-blocking, **P1**, **P2**, **P3** documentation and hygiene.

Triage then keeps one artefact trail:

- Pin the claim to code and tests; a report that cannot be reproduced is
  answered, not silently closed.
- Record a System Maturity finding in `plans/system-maturity/findings-registry.json`
  when the issue belongs to that program.
- Add or reuse a fail-closed scenario in
  `plans/system-maturity/security-regression-suite.json` so that
  `pnpm maturity:security` keeps the boundary under test.
- Close the issue only when the fix **and** its evidence exist on disk.

Memory and context systems, role/memory injection, MCP per-server policy, skill
installation trust, telemetry opt-out, credential inheritance into child
processes, chat resource loading and the renderer/Main privilege boundary are in
scope. Vulnerabilities in vendored or upstream code should be reported upstream
first; if the vendored copy needs a local fix, report it here as well and say
that the upstream report exists. Physical access, social engineering and
third-party service outages are out of scope.

There is no committed response time. Asking for a guaranteed SLA, a public
advisory or a bounty for this private alpha has no defined answer yet, and this
policy does not invent one.

## Evidence boundaries

Security evidence in this repository is **agent-driven** unless a record
explicitly says otherwise. Automated probes, synthetic credentials and isolated
local runs are labelled `driven_by: agent`; no document here claims real-human
verification, real-credential exposure or a live third-party breach. A green
local run is not a release gate and is never a substitute for the release
process.

Related documents:

- [hardware acceleration policy](docs/dev/hardware-acceleration-policy.md) — how a
  frozen product default is documented and what may not be promised about it.
- [repository artifact retention](harness/specs/rules/repository-artifact-retention.md) —
  where evidence lives and what stays local.
- `scripts/validate-policy-docs.mjs` — the checker behind the machine check above.
