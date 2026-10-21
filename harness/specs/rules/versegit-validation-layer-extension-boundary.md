---
id: versegit-validation-layer-extension-boundary
title: VerseGit Concurrent Workspace Control Plane Boundary
type: ai-coding-rule
appliesTo:
  - versegit-validation-layer-extension
  - gateway-backend-communication
severity: error
---

VerseGit (VG) is an **opt-in, host-managed repository fact and candidate control
plane** for multi-worktree or multi-concurrent-agent development. It is not the
harness authority, Git base, execution owner, write-journal owner, or a second task
source.

## Authority

- ClawX keeps task orchestration, Agent assignment, approval, user-workspace
  mutation journal, and the final harness verdict.
- VerseShell owns external command/process execution and its lifecycle receipts.
- VG owns repository-session facts, snapshots/candidates, derived read/write
  analysis, basis receipts, and reports within its own contract.
- VG may advise the host and may emit six-dimensional verdict facts; it must not
  replace `requiredTests`, full-scope evidence, or the host decision.
- VG does not own Task Forest, Task Ledger, ClawGraph, product locks, or release
  authority.

## Modes

- M0 disabled: zero VG process and zero behaviour change.
- M1 diagnostic: deny-by-default read-only queries.
- M2 advisory: host observations plus candidate/next-tree facts.
- M3 candidate: VerseShell-executed plans and VG-consumed receipts.
- M4 broker: optional landing authority, explicitly outside M1-M3 and requiring a
  separate ownership decision and rule amendment.

Mode promotion must be explicit. A profile or environment value must not silently
grant a higher mode.

## Trigger

VG is eligible only when at least one is true:

- the same canonical repository has more than one Git worktree;
- the repository has more than one active Agent/VG session;
- an orchestration plan explicitly requests worktree isolation.

A single-worktree, single-session repository must observe no VG call or behaviour
change. VG must not be added to `fast`, `comms`, or an undeclared implicit profile.

## Execution

- In ClawX host mode, external commands, tests, and verification use the VerseShell
  governed ACI with immutable argv, cwd, owner, deadline, output/artifact bounds,
  and process-tree cleanup.
- VG must not spawn a second verifier, reinterpret shell strings, retry an
  effectful request with unknown delivery, or fall back to native execution.
- VG may keep its standalone executor only for standalone mode. Host mode must be
  plan/receipt-driven; without a VerseShell receipt the result is `unmeasured`.
- Renderer code must not invoke VG CLI, MCP, Gateway HTTP, or a shell directly.
  Host calls go through a typed Main/host adapter.
- `vg land` and `vg admit` are not invoked by M1-M3. ClawX Git and write-journal
  semantics remain unchanged.

## Coverage

VG's current symbol coverage includes Python and TypeScript/TSX query patterns;
this is not full language-service coverage. `.mjs`, `.jsx`, `.sh`, dynamic calls,
reflection, cross-language links, and complex re-exports must be reported as
unsupported or partial rather than inferred as safe.

Read coverage is partial. Structured hooks do not observe Bash direct reads,
network reads, arbitrary MCP tools, or all direct filesystem access. Rules that
depend on the read set may under-trigger. The report must include a coverage vector
and explicit `unobserved` surfaces.

## Error Kinds

The machine-readable report must distinguish at least:

- `not_applicable`: concurrency trigger is absent;
- `unavailable`: binary, service, or required receipt is absent;
- `partial`: facts exist but declared coverage is incomplete;
- `observed`: facts are complete only within the declared coverage;
- `degraded`: timeout, queue, resource, or cleanup degradation;
- `rejected_by_policy`: host policy or identity validation rejected the request.

These values must not be flattened into one boolean.

## Evidence Honesty

- Each result records binary digest, schema/protocol versions, repo/worktree/session
  identity, trigger reason, input digest, run id, artifact digests, and cleanup.
- A red VG result must remain visible; a green VG result cannot upgrade the host
  verdict.
- Absence of a VG conflict is written as "no conflict observed under declared
  coverage", never "no conflict exists".
- `selected` or partial VG-STS evidence never satisfies a full `requiredTests` gate.
- `driven_by: agent` and the actual actor must be recorded; never claim real-human
  evidence.

## Lifecycle and Cleanup

- VG attaches only after the host supplies a canonical repo/worktree/session/owner
  identity.
- VG does not create or delete user worktrees in host mode.
- Late events from an older epoch are stale and cannot overwrite current facts.
- Before cleanup, evidence references and retention decisions must be recorded.
- A crash or missing owner becomes `lost` or `recovery_required`; VG must not adopt
  an orphan process or silently recreate it.
- Cleanup must not delete uncommitted user work or evidence without an explicit
  retention decision.

## Ecosystem Linkage

- VG may expose a deny-by-default read-only MCP surface from its own server or a
  host-owned typed adapter.
- Do not nest VG as a generic tool inside `verseshell-mcp`; that adapter owns a
  different capability/catalog boundary.
- The default read-only profile excludes `declare_intent` and any future write
  tool. Read-only tool allowlists must be reviewed and digest-bound.
- Do not add `land`, `admit`, commit, ref-update, approval bypass, or arbitrary
  shell tools to the model-facing catalog.

## Host-Owned Bootstrap Scope

The MC5 per-PR budget applies to **provider-derived migration slices** that copy,
replace, or re-author VerseGit behaviour. A host-owned anti-corruption bootstrap is
not a provider migration slice when all of the following are true:

- `provider_source_files_changed = 0` and `provider_internal_imports = 0`;
- `behavior_migration = false`;
- executable authority remains fixed to the host adapter and M0-M3 rules;
- the complete provider JSON document is compared against the raw sidecar with an
  empty lossless projection, not a summary;
- pre-execution source, binary, contract, golden and package identity checks pass;
- verifier scripts, tests, fixtures and evidence are digest-bound and treated as
  verification artifacts, not as provider behavioural code.

The bounded host-owned production budget is at most **2 application files and 800
changed lines, with no application file above 800 lines**. Supporting tests, scripts
and evidence are excluded from the provider migration line budget, but failing any
identity, differential, default-off, authority or cleanup control still rejects the
node. This scope does not permit source extraction, provider imports, native
execution, land/admit or a default-on profile.
## Migration Control

- Do not copy the entire VerseGit source tree, repository history, Task Forest data, build outputs, evaluation corpora, or private evidence into ClawX.
- The default migration posture is a versioned sidecar binary consumed through an anti-corruption adapter. Selective source extraction requires a separate decision after the sidecar contract and differential gate are stable.
- Before changing any VG behaviour, capture characterization or golden-master tests for the affected command, report, error path, and cleanup path.
- Every migration slice must have a golden diff against the original VG binary. A whitespace-only diff, an AST-no-op diff, or a diff that exceeds the declared per-PR budget is rejected.
- One pull request may migrate one seam. If a change grows beyond that seam, split it into a new node or proposal instead of expanding the diff.
- Any intentional behaviour change must be recorded in a behaviour-change report with old behaviour, new behaviour, reason, and verification; it must not be hidden inside a refactor.
- Cross-boundary imports must use the public module contract, not deep VG internals or ClawX private types.
- Temporary adapters and compatibility layers must declare their retirement condition. An adapter without a retirement condition is not accepted.

See `harness/specs/guides/versegit-concurrency/versegit-migration-control-plan.md` for the full MC0-MC7 node plan, and `harness/specs/tasks/versegit-module-planning-correction.md` for the active planning correction gate.

## Product Locks

Do not change `defaultOn`, `liveReady`, `productApproved`, release scope, VG's
`safety.default_enable=false`, or `single_green_light=false` through this layer.
No proxy, grep pass, missing binary, or synthetic fixture may be promoted to a GA
or release claim.