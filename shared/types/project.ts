import type { ProjectId, WorkspaceId } from './identity-scope.js';

export type ProjectKnowledgeRef = {
  kind: 'knowledge' | 'task-ledger' | 'document';
  ref: string;
  label: string | null;
};

export type ProjectMasterInstruction = {
  source: string;
  content: string;
  trust: 'owner' | 'user' | 'runtime';
};

/**
 * Read-only Project projection. Project does not replace Workspace, copy its
 * sessions, or own task/trace state.
 */
export type ProjectView = {
  projectId: ProjectId;
  workspaceId: WorkspaceId;
  name: string;
  rootPath: string;
  masterInstruction: ProjectMasterInstruction | null;
  knowledgeRefs: ProjectKnowledgeRef[];
  sessionKeys: string[];
  /** True when this is the transitional 1:1 workspace projection. */
  compatibilityMapped: boolean;
};

export type ProjectProjectionInput = {
  workspaceId: WorkspaceId;
  workspaceName: string;
  rootPath: string;
  masterInstruction?: ProjectMasterInstruction | null;
  knowledgeRefs?: readonly ProjectKnowledgeRef[];
  sessionKeys?: readonly string[];
};

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`Project projection requires ${field}`);
  }
  return value;
}

function uniqueTexts(values: readonly string[] | undefined, field: string): string[] {
  if (values === undefined) return [];
  const seen = new Set<string>();
  return values.map((value, index) => {
    const text = requiredText(value, `${field}[${index}]`);
    if (seen.has(text)) throw new TypeError(`Project projection contains duplicate ${field}`);
    seen.add(text);
    return text;
  });
}

/** Transitional 1:1 mapper; equal bytes do not make Project and Workspace aliases. */
export function createProjectForWorkspace(input: ProjectProjectionInput): ProjectView {
  return {
    projectId: requiredText(input.workspaceId, 'workspaceId') as unknown as ProjectId,
    workspaceId: requiredText(input.workspaceId, 'workspaceId') as WorkspaceId,
    name: requiredText(input.workspaceName, 'workspaceName'),
    rootPath: requiredText(input.rootPath, 'rootPath'),
    masterInstruction: input.masterInstruction
      ? {
          source: requiredText(input.masterInstruction.source, 'masterInstruction.source'),
          content: requiredText(input.masterInstruction.content, 'masterInstruction.content'),
          trust: input.masterInstruction.trust,
        }
      : null,
    knowledgeRefs: [...(input.knowledgeRefs ?? [])],
    sessionKeys: uniqueTexts(input.sessionKeys, 'sessionKeys'),
    compatibilityMapped: true,
  };
}
