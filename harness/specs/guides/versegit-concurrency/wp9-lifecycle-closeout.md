---
id: versegit-wp9-lifecycle-closeout
title: VerseGit host-module lifecycle closeout
type: guide
appliesTo:
  - versegit-validation-layer-extension
---

# VerseGit host-module lifecycle closeout

> Status: engineering acceptance is complete with retained gaps. VerseGit remains a
> standalone product and ClawX receives a narrow, opt-in host-module profile. This is
> not GA, not default-on, not release eligibility and not M4 authorization.

## 1. Final positioning

VerseGit is the host-managed repository fact, candidate and evidence plane for
concurrent workspaces. ClawX remains the owner of task state, approvals, shell
execution, write journal, Git landing and the harness verdict.

```text
ClawX task / worktree / session
  -> host-owned fixed-argv VG fact adapter
  -> VG repository facts and candidate identity
  -> VerseShell governed execution
  -> host-authoritative execution receipt
  -> VG receipt interpretation
  -> host-owned harness verdict
```

The module has no second task forest, executor, approval plane or landing authority.
Its strongest current authority is bounded `observed` evidence, not `admitted` and not
an automatic Git decision.

## 2. Lifecycle

| Stage | Trigger | Allowed authority | Current evidence |
| --- | --- | --- | --- |
| M0 identity | explicit contract probe | version/capability facts only | WP0 |
| M1 diagnostic | opt-in `concurrency-aux` plus concurrency trigger | read-only advisory facts | WP1/WP2/MC4 |
| M2 candidate facts | host candidate plus frozen inputs | candidate/advisory evidence | WP5/WP7 |
| M3 bounded verification | host plan plus VerseShell receipt | execution fact remains host-owned | WP7 bounded slice |
| M4 landing broker | separate ownership decision | none | not authorized |

The M3 row is deliberately narrow: WP7 proves an agent-driven Windows vertical slice,
not a real external-model conversation, full-language coverage or a product-wide M3
GA claim.

## 3. Migration control

The independent VerseGit repository is not copied into ClawX. The accepted migration
shape is a sidecar with versioned cross-boundary documents:

- MC0 freezes the provider source, binary, schema and behavior baseline;
- MC1 defines the anti-corruption consumer contract;
- MC2 preserves behavior with a characterization fingerprint;
- MC3 pins sidecar delivery identity;
- MC4 implements one host-owned adapter seam;
- MC5 enforces differential migration budgets and behavior-change disclosure;
- MC6 retains `sidecar-only` because no measured in-process requirement exists;
- MC7 is retired into WP6 rather than creating a second closeout authority.

This structure addresses the two original migration risks without giving an LLM a
license to rewrite the provider:

1. no clean-project files are moved merely by importing the module;
2. behavior changes must survive the same frozen fixtures, differential projections,
   negative controls, candidate identity and evidence manifests.

## 4. VerseShell coupling

Host mode separates provider facts from execution:

- VG `init`, `version`, `capabilities`, `session`, `observe` and `check` calls use a
  host-owned fixed-argv adapter and cannot execute user code;
- candidate verification, user tests and builds run only through VerseShell governed
  ACI;
- a receipt is not accepted from the caller as a self-report; file-backed plan,
  observation, stdout, stderr, input manifest and process identity must agree;
- failure is consumed before continuation and cannot be overwritten by a later pass;
- process, worktree and temporary-resource inventories must return to zero survivors.

The harness verdict stays host-owned. VG receipt status is residual input, never a
replacement for the host pass/fail decision.

## 5. Behavior monitoring

The behavior model distinguishes direct evidence from inference and non-observation.
It must not flatten `partial`, `unavailable`, `unknown`, `unmeasured` or
`recovery_required` into a clean result.

Required visible boundaries remain:

- shell-derived and process-derived reads;
- direct filesystem access outside host instrumentation;
- arbitrary MCP reads/writes outside typed host surfaces;
- network and browser activity;
- language coverage beyond the bounded fixtures;
- non-Windows platforms;
- external-model invocation and full product M3.

## 6. Residual disposition

WP8 retained three P2 residuals:

1. a fresh live artifact and frozen curated snapshot require explicit paired
   validation;
2. only a Windows, agent-driven, bounded host slice is observed;
3. historical planning-manifest drift and upstream review failure are preserved as
   history rather than repaired into a new pass claim.

WP6 additionally retains the unavailable `conflicts-plan` seam, dirty provider source,
debug-only binary, release-ineligible posture and M4 recovery prerequisites. These
gaps are reasons for `PASS_WITH_GAPS`, not reasons to reopen claims that already have
direct evidence.

## 7. Closeout rule

TF-0515 may close only after:

- all 19 required TF-0465 children are `done` or explicitly `deprecated`;
- the corrected WP7 candidate commit/tree remains resolvable;
- WP6 and WP8 independent verifiers pass;
- all seven TF-0465 acceptance criteria map to digest-bound evidence;
- the report, manifest and both checksum surfaces replay;
- Task Forest validation shows no remaining required child blocker.

Closing the engineering goal changes no product default or release lock. A future
release, default-on decision, real-model M3 trial or M4 landing broker needs a separate
task and, where required by repository policy, a separate owner decision.
