import YAML from "yaml";
import type {
  ClawGraphCompileResult,
  ClawGraphDiagnostic,
  ClawGraphIR,
  ClawGraphIRNode,
  ClawGraphNodeType,
  ClawGraphWorkflowSpec,
} from "./types.js";

type CompileOptions = {
  sourcePath?: string;
  availableRuntimeRoles?: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const text = readString(entry);
        return text ? [text] : [];
      })
    : [];
}

function diagnostic(
  severity: ClawGraphDiagnostic["severity"],
  code: string,
  message: string,
  extra: Partial<ClawGraphDiagnostic> = {},
): ClawGraphDiagnostic {
  return { severity, code, message, ...extra };
}

function normalizeNodeType(value: unknown): ClawGraphNodeType {
  return value === "audit" ? "audit" : "agent";
}

function normalizeMaxParallel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3;
  }
  return Math.max(1, Math.min(12, Math.floor(value)));
}

function findCycle(nodes: readonly ClawGraphIRNode[]): string[] | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    if (visited.has(id)) return null;
    if (visiting.has(id)) {
      const index = stack.indexOf(id);
      return index >= 0 ? [...stack.slice(index), id] : [id];
    }
    visiting.add(id);
    stack.push(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const node of nodes) {
    const cycle = visit(node.id);
    if (cycle) return cycle;
  }
  return null;
}

export function parseClawGraphWorkflowYaml(workflowYaml: string, options: CompileOptions = {}): ClawGraphCompileResult {
  const diagnostics: ClawGraphDiagnostic[] = [];
  let parsed: unknown;
  try {
    parsed = YAML.parse(workflowYaml);
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        diagnostic("error", "yaml_parse_error", error instanceof Error ? error.message : String(error)),
      ],
    };
  }

  if (!isRecord(parsed)) {
    return { ok: false, diagnostics: [diagnostic("error", "invalid_root", "Workflow YAML must be an object.")] };
  }

  const spec = parsed as Partial<ClawGraphWorkflowSpec>;
  if (spec.schemaVersion !== 1) {
    diagnostics.push(diagnostic("error", "schema_version", "schemaVersion must be 1.", { path: "schemaVersion" }));
  }
  if (!isRecord(spec.workflow)) {
    diagnostics.push(diagnostic("error", "workflow_required", "workflow is required.", { path: "workflow" }));
  }
  const workflowId = readString(spec.workflow?.id);
  const objective = readString(spec.workflow?.objective);
  if (!workflowId) {
    diagnostics.push(diagnostic("error", "workflow_id_required", "workflow.id is required.", { path: "workflow.id" }));
  }
  if (!objective) {
    diagnostics.push(diagnostic("error", "objective_required", "workflow.objective is required.", { path: "workflow.objective" }));
  }

  const models = isRecord(spec.models) ? spec.models : {};
  const roles = isRecord(spec.roles) ? spec.roles : {};
  if (Object.keys(roles).length === 0) {
    diagnostics.push(diagnostic("error", "roles_required", "At least one role is required.", { path: "roles" }));
  }
  const availableRuntimeRoles = new Set(options.availableRuntimeRoles ?? []);
  const runtimeRoleKnown = availableRuntimeRoles.size > 0
    ? (roleName: string) => availableRuntimeRoles.has(roleName)
    : () => true;

  for (const [roleId, roleValue] of Object.entries(roles)) {
    if (!isRecord(roleValue)) {
      diagnostics.push(diagnostic("error", "role_invalid", `Role "${roleId}" must be an object.`, { path: `roles.${roleId}` }));
      continue;
    }
    const runtimeRole = readString(roleValue.runtimeRole);
    if (!runtimeRole) {
      diagnostics.push(diagnostic("error", "runtime_role_required", `Role "${roleId}" requires runtimeRole.`, { path: `roles.${roleId}.runtimeRole` }));
    } else if (!runtimeRoleKnown(runtimeRole)) {
      diagnostics.push(diagnostic("error", "runtime_role_unknown", `Unknown runtime role "${runtimeRole}".`, { path: `roles.${roleId}.runtimeRole` }));
    }
    const modelKey = readString(roleValue.model);
    if (modelKey && !isRecord(models[modelKey])) {
      diagnostics.push(diagnostic("error", "model_unknown", `Unknown model key "${modelKey}".`, { path: `roles.${roleId}.model` }));
    }
    const sandbox = readString(roleValue.sandbox);
    if (sandbox && !["read", "strict", "write"].includes(sandbox)) {
      diagnostics.push(diagnostic("error", "sandbox_invalid", `Invalid sandbox "${sandbox}".`, { path: `roles.${roleId}.sandbox` }));
    }
  }

  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    diagnostics.push(diagnostic("error", "nodes_required", "At least one node is required.", { path: "nodes" }));
  }

  const nodeIds = new Set<string>();
  const nodes: ClawGraphIRNode[] = [];
  for (const [index, rawNode] of (Array.isArray(spec.nodes) ? spec.nodes : []).entries()) {
    const path = `nodes.${index}`;
    if (!isRecord(rawNode)) {
      diagnostics.push(diagnostic("error", "node_invalid", `Node at index ${index} must be an object.`, { path }));
      continue;
    }
    const id = readString(rawNode.id);
    const task = readString(rawNode.task);
    if (!id) {
      diagnostics.push(diagnostic("error", "node_id_required", "Node id is required.", { path: `${path}.id` }));
      continue;
    }
    if (nodeIds.has(id)) {
      diagnostics.push(diagnostic("error", "node_id_duplicate", `Duplicate node id "${id}".`, { path: `${path}.id`, nodeId: id }));
    }
    nodeIds.add(id);
    if (!task) {
      diagnostics.push(diagnostic("error", "node_task_required", `Node "${id}" requires task.`, { path: `${path}.task`, nodeId: id }));
    }
    const type = normalizeNodeType(rawNode.type);
    const roleKey = readString(rawNode.role);
    if (type === "agent" && !roleKey) {
      diagnostics.push(diagnostic("error", "node_role_required", `Agent node "${id}" requires role.`, { path: `${path}.role`, nodeId: id }));
    }
    const role = roleKey ? roles[roleKey] : undefined;
    if (roleKey && !isRecord(role)) {
      diagnostics.push(diagnostic("error", "node_role_unknown", `Unknown node role "${roleKey}".`, { path: `${path}.role`, nodeId: id }));
    }
    const roleRecord = isRecord(role) ? role : undefined;
    const modelKey = readString(roleRecord?.model);
    const model = modelKey ? models[modelKey] : undefined;
    const modelRef = isRecord(model) ? readString(model.modelRef) ?? null : null;
    nodes.push({
      id,
      type,
      ...(roleKey ? { role: roleKey } : {}),
      ...(readString(roleRecord?.runtimeRole) ? { runtimeRole: readString(roleRecord?.runtimeRole) } : {}),
      modelRef,
      ...(readString(roleRecord?.sandbox) ? { sandbox: readString(roleRecord?.sandbox) } : {}),
      task: task ?? "",
      dependsOn: readStringArray(rawNode.dependsOn),
      checks: readStringArray(rawNode.checks),
      required: rawNode.required !== false,
    });
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeIds.has(dep)) {
        diagnostics.push(diagnostic("error", "dependency_unknown", `Node "${node.id}" depends on unknown node "${dep}".`, { nodeId: node.id }));
      }
    }
  }
  const cycle = findCycle(nodes);
  if (cycle) {
    diagnostics.push(diagnostic("error", "dag_cycle", `Workflow graph contains a cycle: ${cycle.join(" -> ")}.`));
  }

  if (diagnostics.some((entry) => entry.severity === "error")) {
    return { ok: false, diagnostics };
  }

  const ir: ClawGraphIR = {
    schemaVersion: 1,
    workflowId: workflowId!,
    title: readString(spec.workflow?.title) ?? workflowId!,
    objective: objective!,
    nodes,
    maxParallel: normalizeMaxParallel(spec.control?.maxParallel),
    policies: Array.isArray(spec.control?.policies)
      ? spec.control.policies.flatMap((policy) => {
          if (!isRecord(policy)) return [];
          const on = readString(policy.on);
          const action = readString(policy.action);
          if (!on || !action) return [];
          const maxAttempts = typeof policy.maxAttempts === "number" && Number.isFinite(policy.maxAttempts)
            ? Math.max(0, Math.floor(policy.maxAttempts))
            : undefined;
          return [{ on, action, ...(maxAttempts !== undefined ? { maxAttempts } : {}) }];
        })
      : [],
    termination: readStringArray(spec.termination?.conditions),
    ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
  };
  return { ok: true, ir, diagnostics };
}
