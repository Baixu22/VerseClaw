export type RunbookTemplate = {
  id: string;
  version: string;
  title: string;
  intent: string[];
  requiredRoles: string[];
  optionalRoles: string[];
  graph: {
    nodes: RunbookTemplateNode[];
  };
  verification: {
    verifierRole: string;
    expectedEvidence: string[];
  };
  handoff: {
    rules: string[];
  };
};

export type RunbookTemplateNode = {
  id: string;
  roleName: string;
  task: string;
  dependsOn?: string[];
  verifier?: boolean;
};

export type RunbookValidationIssue = {
  path: string;
  message: string;
};

export type RunbookValidationResult = {
  ok: boolean;
  issues: RunbookValidationIssue[];
};

const UNSAFE_NODE_FIELDS = ["tools", "permissions", "prompt"] as const;

function pushRequiredStringIssue(
  issues: RunbookValidationIssue[],
  path: string,
  value: string | undefined,
): void {
  if (!value?.trim()) {
    issues.push({ path, message: "required string is missing" });
  }
}

function checkRole(params: {
  issues: RunbookValidationIssue[];
  path: string;
  roleName: string;
  knownRoles: Set<string>;
}): void {
  if (!params.roleName.trim()) {
    params.issues.push({ path: params.path, message: "role name is required" });
    return;
  }
  if (!params.knownRoles.has(params.roleName)) {
    params.issues.push({ path: params.path, message: `unknown role: ${params.roleName}` });
  }
}

export function validateRunbookTemplate(
  template: RunbookTemplate,
  knownRoleNames: readonly string[],
): RunbookValidationResult {
  const issues: RunbookValidationIssue[] = [];
  const knownRoles = new Set(knownRoleNames);

  pushRequiredStringIssue(issues, "id", template.id);
  pushRequiredStringIssue(issues, "version", template.version);
  pushRequiredStringIssue(issues, "title", template.title);
  if (template.intent.length === 0) {
    issues.push({ path: "intent", message: "intent matchers are required" });
  }

  template.requiredRoles.forEach((roleName, index) =>
    checkRole({ issues, path: `requiredRoles[${index}]`, roleName, knownRoles })
  );
  template.optionalRoles.forEach((roleName, index) =>
    checkRole({ issues, path: `optionalRoles[${index}]`, roleName, knownRoles })
  );
  checkRole({
    issues,
    path: "verification.verifierRole",
    roleName: template.verification.verifierRole,
    knownRoles,
  });
  if (template.verification.expectedEvidence.filter((entry) => entry.trim()).length === 0) {
    issues.push({ path: "verification.expectedEvidence", message: "expected evidence is required" });
  }

  const nodeIds = new Set<string>();
  template.graph.nodes.forEach((node, index) => {
    pushRequiredStringIssue(issues, `graph.nodes[${index}].id`, node.id);
    pushRequiredStringIssue(issues, `graph.nodes[${index}].task`, node.task);
    checkRole({
      issues,
      path: `graph.nodes[${index}].roleName`,
      roleName: node.roleName,
      knownRoles,
    });
    if (nodeIds.has(node.id)) {
      issues.push({ path: `graph.nodes[${index}].id`, message: `duplicate node id: ${node.id}` });
    }
    nodeIds.add(node.id);

    const rawNode = node as Record<string, unknown>;
    for (const field of UNSAFE_NODE_FIELDS) {
      if (field in rawNode) {
        issues.push({
          path: `graph.nodes[${index}].${field}`,
          message: `${field} cannot be declared by a runbook`,
        });
      }
    }
  });

  template.graph.nodes.forEach((node, nodeIndex) => {
    node.dependsOn?.forEach((dependency, dependencyIndex) => {
      if (!nodeIds.has(dependency)) {
        issues.push({
          path: `graph.nodes[${nodeIndex}].dependsOn[${dependencyIndex}]`,
          message: `unknown dependency: ${dependency}`,
        });
      }
    });
  });

  return {
    ok: issues.length === 0,
    issues,
  };
}
