import { describe, expect, it } from 'vitest';
import { parseClawGraphWorkflowYaml } from '../../openclaw_runtime/src/agents/clawgraph/compiler';

const VALID_WORKFLOW = `
schemaVersion: 1
workflow:
  id: long_task_pipeline_v1
  title: Long task pipeline
  objective: Ship a stable long-task feature

models:
  strong: { modelRef: "openai/gpt-5.3" }
  fast: { modelRef: "openai/gpt-5.3-mini" }

roles:
  planner: { runtimeRole: planner, model: fast, sandbox: read }
  implementer: { runtimeRole: implementer, model: strong, sandbox: strict }
  auditor: { runtimeRole: reviewer, model: fast, sandbox: read }

nodes:
  - id: split
    type: agent
    role: planner
    task: Split the objective into executable slices.
  - id: implement
    type: agent
    role: implementer
    dependsOn: [split]
    task: Implement the approved slices.
  - id: audit
    type: audit
    role: auditor
    dependsOn: [implement]
    task: Verify the implementation evidence.
    checks: [schema_valid, trace_exists, evidence_refs_exist, files_inside_workspace]

control:
  maxParallel: 3
  policies:
    - on: node_failed
      action: retry
      maxAttempts: 2

termination:
  conditions: [all_required_nodes_done, audit_pass, no_open_review]
`;

describe('ClawGraph YAML compiler', () => {
  it('compiles a valid workflow into normalized IR', () => {
    const result = parseClawGraphWorkflowYaml(VALID_WORKFLOW, {
      sourcePath: '/workspace/.clawx/clawgraph/long.yaml',
      availableRuntimeRoles: ['planner', 'implementer', 'reviewer'],
    });

    expect(result.ok).toBe(true);
    expect(result.ir?.workflowId).toBe('long_task_pipeline_v1');
    expect(result.ir?.maxParallel).toBe(3);
    expect(result.ir?.nodes.map((node) => node.id)).toEqual(['split', 'implement', 'audit']);
    expect(result.ir?.nodes[1]).toMatchObject({
      role: 'implementer',
      runtimeRole: 'implementer',
      modelRef: 'openai/gpt-5.3',
      dependsOn: ['split'],
    });
  });

  it('reports unknown roles, models, duplicate ids, and missing dependencies', () => {
    const result = parseClawGraphWorkflowYaml(`
schemaVersion: 1
workflow: { id: broken, objective: Broken graph }
models:
  fast: { modelRef: "fast" }
roles:
  planner: { runtimeRole: ghost, model: missing, sandbox: root }
nodes:
  - { id: a, role: planner, task: Start, dependsOn: [missing] }
  - { id: a, role: absent, task: Duplicate }
`, {
      availableRuntimeRoles: ['planner'],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'runtime_role_unknown',
      'model_unknown',
      'sandbox_invalid',
      'node_id_duplicate',
      'node_role_unknown',
      'dependency_unknown',
    ]));
  });

  it('rejects cyclic graphs', () => {
    const result = parseClawGraphWorkflowYaml(`
schemaVersion: 1
workflow: { id: cycle, objective: Cycle }
roles:
  planner: { runtimeRole: planner }
nodes:
  - { id: a, role: planner, task: A, dependsOn: [b] }
  - { id: b, role: planner, task: B, dependsOn: [a] }
`, {
      availableRuntimeRoles: ['planner'],
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'dag_cycle')).toBe(true);
  });
});
