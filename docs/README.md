# Development documentation

Start with the [architecture overview](architecture-overview.md), [product semantics](clawx-product-semantics.md), and the [default configuration matrix](dev/default-config-matrix.md).

## Module deep dives

The root README links here for current, source-grounded module descriptions. These pages separate implemented paths, product defaults, internal-only components, retired surfaces and validation gaps.

- [Module index](modules/README.md)
- [LLM and models](modules/llm-and-models.md)
- [Sessions and continuity](modules/sessions.md)
- [Context and memory](modules/context-and-memory.md)
- [Workspace and coding](modules/workspace-and-coding.md)
- [Knowledge base](modules/knowledge-base.md)
- [Multi-agent and tasks](modules/multi-agent-and-tasks.md)
- [VerseGit / VerseShell / VerseBrowser](modules/verse-tools.md)
- [Resources and observability](modules/resources-and-observability.md)
- [Harness and Codex](modules/harness-and-codex.md)
- [Integrations and surfaces](modules/integrations-and-surfaces.md)
- [Development and validation](modules/development-and-validation.md)
- [Component inventory](modules/component-inventory.md)

The deep dives are maintained in Simplified Chinese. Code paths, API names and evidence references are language-neutral.

## Architecture and product

- [Architecture overview](architecture-overview.md)
- [Desktop design overview](clawx-design-overview.md)
- [Product semantics](clawx-product-semantics.md)
- [Runtime control planes](dev/runtime-control-planes.md)
- [Subsystem seam map](SEAM_MAP.md)
- [Context Engine rebuild specification](CONTEXT_ENGINE_REBUILD_SPEC.md)
- [Context orchestrator](dev/context-orchestrator.md)
- [Memory control plane](dev/memory-control-plane.md)
- [Component disposition matrix](dev/component-disposition-matrix-20261021.md)
- [Architecture skeleton convergence charter](dev/architecture-skeleton/CHARTER.md)
- [Role-first design](role-first-design.md)
- [Role identity taxonomy](role-identity-taxonomy.md)
- [Role packs](role-packs.md)
- [Role maturation and enhancement proposal](role-maturation-and-enhancement-proposal.md)

## Development and operations

- [Agent development control plane](agent-dev-control-plane.md)
- [Agent development tooling evaluation](agent-dev-tooling-evaluation.md)
- [Product acceptance strategy and shortfall ledger](../harness/specs/guides/product-acceptance-strategy.md)
- [Agent-first acceptance system](../harness/specs/guides/agent-first-acceptance.md)
- [RSI TF-0604 baseline corpus](../harness/specs/tasks/rsi-tf0604-baseline-corpus.md): sealed agent-driven task corpus, baseline reservation and negative controls.
- [RSI TF-0592 statistical adjudication](../harness/specs/tasks/rsi-tf0592-statistical-adjudication.md): resource/source fingerprints, repeated-trial aggregation, paired uncertainty and sealed readback.
- [Agent-first system task corpus](../harness/specs/tasks/agent-first-task-corpus.md): 24 maintained QA and failure-boundary tasks with a frozen 16/8 split and deterministic grader calibration.
- [RSI historical task corpus and grader calibration](../harness/specs/tasks/agent-first-task-corpus-calibration.md): 24 historical engineering tasks, a separate frozen 12/12 split, executable reference oracles and qualitative calibration receipts.
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
- [P2 issue fix: bounded runtime performance baseline](dev/p2-issue-fixes-batch16-20261010.md)

## Historical records

- [Week 7-8 changelog](week7-8-changelog.md)
- [Mock UI development notes](mock-ui-dev.md)

## Component documentation

- [Agent Dev control plane](agent-dev-control-plane.md): daily development and diagnostics.
- [Context Runtime Kit](context-runtime-kit/README.md): contracts and integration.
- [Knowledge persistence and review](enhancements/knowledge-persistence/README.md): governance and retrieval.
- [Multi-agent orchestration](multi-agent-orchestration/README.md): roles, routing, scheduling and acceptance.
- [VerseGit control plane](dev/versegit-validation-layer/README.md): repository semantics and evidence boundaries.
- [VerseShell status](dev/verseshell-foundation/STATUS.md): typed ACI and controlled canary.
- [VerseBrowser integration](../packages/README.md#versebrowser-integration-and-invocation): contract, driver and model-action limits.
- [Runtime convergence](dev/unified-agent-system/runtime-convergence/README.md): authority boundaries and acceptance.
- [Windows alpha qualification](dev/windows-alpha-closeout-20261008.md): tested scope and remaining limits.
- [Source retention](dev/repository-artifact-retention.md): what belongs in a clone, local output rules and recovery.
- [Repository layout](dev/repository-layout.md): top-level directory ownership and evidence roots.
- [Harness specifications](../harness/specs/): reusable rules, scenarios and implementation contracts.

Historical task journals, audit drafts and raw run output are not developer prerequisites. Old paths mentioned in historical contracts describe the original candidate; recover them from Git history, not by re-adding private working history to the source tree.
