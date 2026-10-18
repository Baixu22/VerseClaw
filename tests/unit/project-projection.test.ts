import { describe, expect, it } from 'vitest';
import { createProjectForWorkspace } from '@shared/types/project';
import type { ProjectId, WorkspaceId } from '@shared/types/identity-scope';

describe('Project read-only projection', () => {
  it('projects an existing workspace without migration', () => {
    const project = createProjectForWorkspace({
      workspaceId: 'workspace-a' as WorkspaceId,
      workspaceName: 'Workspace A',
      rootPath: '/workspace/a',
      sessionKeys: ['session-1', 'session-2'],
    });
    expect(project).toEqual({
      projectId: 'workspace-a',
      workspaceId: 'workspace-a',
      name: 'Workspace A',
      rootPath: '/workspace/a',
      masterInstruction: null,
      knowledgeRefs: [],
      sessionKeys: ['session-1', 'session-2'],
      compatibilityMapped: true,
    });
    expect(project.projectId as unknown as ProjectId).toBe('workspace-a');
    expect(project.workspaceId).toBe('workspace-a');
  });

  it('keeps master instruction and knowledge refs explicit', () => {
    const project = createProjectForWorkspace({
      workspaceId: 'workspace-b' as WorkspaceId,
      workspaceName: 'Workspace B',
      rootPath: '/workspace/b',
      masterInstruction: { source: 'AGENTS.md', content: 'Follow the owner rules.', trust: 'owner' },
      knowledgeRefs: [{ kind: 'knowledge', ref: 'page-1', label: 'Design notes' }],
    });
    expect(project.masterInstruction).toMatchObject({ source: 'AGENTS.md', trust: 'owner' });
    expect(project.knowledgeRefs).toEqual([{ kind: 'knowledge', ref: 'page-1', label: 'Design notes' }]);
  });

  it('rejects duplicate projection identities', () => {
    expect(() => createProjectForWorkspace({
      workspaceId: 'workspace-c' as WorkspaceId,
      workspaceName: 'Workspace C',
      rootPath: '/workspace/c',
      sessionKeys: ['session-1', 'session-1'],
    })).toThrow('duplicate sessionKeys');
  });
});
