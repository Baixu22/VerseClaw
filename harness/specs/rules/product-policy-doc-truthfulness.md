---
id: product-policy-doc-truthfulness
title: Product Policy Document Truthfulness
type: rule
pathPatterns:
  - SECURITY.md
  - docs/dev/hardware-acceleration-policy.md
  - electron/main/index.ts
  - scripts/validate-policy-docs.mjs
  - tests/unit/policy-doc-truthfulness.test.ts
requiredTests:
  - pnpm docs:policy:validate
  - pnpm exec vitest run tests/unit/policy-doc-truthfulness.test.ts
---

# Product Policy Document Truthfulness

Policy documents and source comments describe what the product **does**. When
they describe a switch, version, contact path or process that does not exist,
they are defects: a reader cannot tell a missing feature from a documented one,
and a triager is sent to a policy that was never finished.

This rule binds the security policy and any document that freezes a product
default.

## Requirements

- **No template scaffolding.** A published policy document MUST NOT retain
  boilerplate authoring text, sample version rows, or "use this section"
  placeholders. Template text is a failure, not a cosmetic issue.
- **Support scope matches reality.** A support statement MUST name the version
  that `package.json` actually declares and the ref that is actually maintained.
  When the version changes, the statement changes in the same commit. A support
  table that has drifted from the manifest is a failure, not a stale note.
- **No invented guarantees.** Response times, SLA, disclosure calendars, bounty
  terms and contact addresses MUST NOT be implied unless they exist. Where
  nothing is promised, the document MUST say so explicitly.
- **Private reporting stays private.** A report path MUST NOT require publishing
  the repository, credentials or vulnerability details, and MUST NOT invent
  public contact information. It MUST warn against pasting live credentials and
  MUST prefer rotating a leaked credential over sending it.
- **Wired to the real process.** Security policy MUST point at the assets the
  process actually uses, so triage does not begin by reconstructing them.
- **Comments must not promise unimplemented switches.** A source comment MUST
  NOT present a CLI flag, environment variable or config key as a user option
  unless the implementation reads it. A frozen default MUST have a decision
  record stating the lock, the rationale, what is absent, and what a change
  would require.
- **Fail closed.** A missing document, an unreadable manifest or an unresolvable
  reference is a failure. An unchecked policy is never a satisfied policy.

## Boundaries

- This rule does not decide product defaults. Whether a frozen default may be
  changed is a publisher decision; the rule only requires that the current state
  is described truthfully and that the change path is written down.
- This rule does not replace the security regression suite, the Findings
  registry or the release process; it only keeps the documents pointing at them.
- Documentation duplication is not required. One canonical decision record per
  frozen default is enough; other documents link to it.

## Validation

- `pnpm docs:policy:validate` — compares `SECURITY.md`, the hardware
  acceleration decision record and the Main-process source against
  `package.json`, the tracking assets and the filesystem.
- `pnpm exec vitest run tests/unit/policy-doc-truthfulness.test.ts` — pins the
  fail-closed behaviour on synthetic template, version, link and switch inputs.
