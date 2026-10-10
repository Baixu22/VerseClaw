# Development documentation

Start with [architecture](architecture-overview.md), [product semantics](clawx-product-semantics.md),
and the [default configuration matrix](dev/default-config-matrix.md).

## Architecture and product

- [Architecture overview](architecture-overview.md)
- [Desktop design overview](clawx-design-overview.md)
- [Product semantics](clawx-product-semantics.md)
- [Subsystem seam map](SEAM_MAP.md)
- [Context Engine rebuild specification](CONTEXT_ENGINE_REBUILD_SPEC.md)
- [Role-first design](role-first-design.md)
- [Role identity taxonomy](role-identity-taxonomy.md)
- [Role packs](role-packs.md)

## Development and operations

- [Agent development control plane](agent-dev-control-plane.md)
- [Agent development tooling evaluation](agent-dev-tooling-evaluation.md)
- [Coding and DCS design lessons](agent-coding-and-dcs-design-lessons.md)
- [Capability parity for basic chat](codex-capability-parity-basic-chat.md)
- [DCS production P0 runbook](dcs-production-p0-runbook.md)
- [DCS production P0 runbook (Chinese)](dcs-production-p0-runbook.zh-CN.md)
- [Repository layout and artifact roots](dev/repository-layout.md)
- [Source retention and recovery](dev/repository-artifact-retention.md)
- [P2 issue fixes: receipt decisions and transcript call identity](dev/p2-issue-fixes-batch9-20261010.md)
- [P2 issue fix: renderer CSP least privilege](dev/p2-issue-fixes-batch10-20261010.md)
- [P2 issue fix: failed and retried usage attribution](dev/p2-issue-fixes-batch11-20261010.md)
- [P2 issue fix: cross-run observability Problems](dev/p2-issue-fixes-batch12-20261010.md)
- [P2 issue fix: automated runtime-memory cutover evidence gate](dev/p2-issue-fixes-batch13-20261010.md)
- [P2 issue fix: deprecated zero-call exports](dev/p2-issue-fixes-batch14-20261010.md)
- [P2 issue fix: LoCoMo cached/fresh mirrored tails](dev/p2-issue-fixes-batch15-20261010.md)

## Historical records

- [Week 7-8 changelog](week7-8-changelog.md)
- [Mock UI development notes](mock-ui-dev.md)

## Component documentation

- [Agent Dev control plane](agent-dev-control-plane.md): daily development and diagnostics.
- [Context Runtime Kit](context-runtime-kit/README.md): contracts and integration.
- [Runtime convergence](dev/unified-agent-system/runtime-convergence/README.md): authority boundaries and acceptance.
- [Windows alpha qualification](dev/windows-alpha-closeout-20261008.md): tested scope and remaining limits.
- [Source retention](dev/repository-artifact-retention.md): what belongs in a clone, local output rules and recovery.
- [Repository layout](dev/repository-layout.md): top-level directory ownership and evidence roots.
- [Harness specifications](../harness/specs/): reusable rules, scenarios and implementation contracts.

Historical task journals, audit drafts and raw run output are not developer prerequisites.
Old paths mentioned in historical contracts describe the original candidate; recover them from Git history,
not by re-adding private working history to the source tree.
