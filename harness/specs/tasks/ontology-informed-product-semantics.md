---
id: ontology-informed-product-semantics
lifecycleStatus: active
title: Ontology-Informed Product Semantic Relations
type: task
intent: Add a small, evidence-backed directed relation contract to existing ClawX product semantics so ownership boundaries are machine-checkable without adding a graph store or changing runtime behavior.
requiredRules:
  - docs-sync
  - repository-artifact-retention
  - context-family-boundary
ownedPaths:
  - shared/product-semantics.ts
  - tests/unit/product-semantics.test.ts
  - docs/clawx-product-semantics.md
  - harness/specs/tasks/ontology-informed-product-semantics.md
  - harness/specs/guides/ontology-agent-systems-research.md
requiredTests:
  - pnpm harness context --spec harness/specs/tasks/ontology-informed-product-semantics.md
  - pnpm harness validate --spec harness/specs/tasks/ontology-informed-product-semantics.md --no-diff
  - pnpm exec vitest run tests/unit/product-semantics.test.ts
  - pnpm run typecheck
  - node scripts/check-repository-artifacts.mjs
  - git diff --check
acceptance:
  - Existing product concepts remain the node vocabulary and relation endpoints reference only declared concept IDs.
  - Relations are typed, directed, evidence-backed, and name their existing authority boundary.
  - A regression test rejects duplicate edges, unknown endpoints, self-edges, missing evidence, and accidental reverse Task Ledger authority.
  - Product documentation states that this is not a universal ontology, inference engine, graph database, permission grant, or runtime path.
  - Existing owners, contracts, runtime behavior, prompt, storage, defaults, product locks, and release state remain unchanged.
nonGoals:
  - RDF/OWL serialization, semantic-web reasoner, enterprise-wide knowledge graph, prompt injection, tool authorization, runtime routing, or product adoption claims.
---

This task adds a narrow source-level semantic contract only. It does not claim ontology work causes adoption or enterprise readiness.
