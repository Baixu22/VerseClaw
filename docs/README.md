# Development documentation

Start with [architecture](architecture-overview.md), [product semantics](clawx-product-semantics.md),
and the [default configuration matrix](dev/default-config-matrix.md).

- [Agent Dev control plane](agent-dev-control-plane.md): daily development and diagnostics.
- [Context Runtime Kit](context-runtime-kit/README.md): contracts and integration.
- [Runtime convergence](dev/unified-agent-system/runtime-convergence/README.md): authority boundaries and acceptance.
- [Windows alpha qualification](dev/windows-alpha-closeout-20261008.md): tested scope and remaining limits.
- [Source retention](dev/repository-artifact-retention.md): what belongs in a clone, local output rules and recovery.

Reusable rules, scenarios and implementation contracts live in [Harness](../harness/specs/).
Historical task journals, audit drafts and raw run output are not developer prerequisites.
Old paths mentioned in historical contracts describe the original candidate; recover them from Git history,
not by re-adding private working history to the source tree.
