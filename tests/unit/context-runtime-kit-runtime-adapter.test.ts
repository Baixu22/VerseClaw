import { describe, expect, it } from 'vitest';
import { buildCvkCompilerInputFromRuntimeContext } from '../../openclaw_runtime/src/context-engine/cvk/runtime-adapter';

describe('Context Runtime Kit runtime adapter', () => {
  it('converts active tools, context files, and skills into deterministic compiler input', () => {
    const input = buildCvkCompilerInputFromRuntimeContext({
      activeTools: [
        {
          name: 'write_file',
          label: 'Write File',
          description: 'Write a file in the workspace.',
          parameters: {
            type: 'object',
            required: ['path', 'content'],
            properties: {
              content: { type: 'string', description: 'File content.' },
              mode: {
                type: 'string',
                enum: ['overwrite', 'append'],
                default: 'overwrite',
              },
              path: { type: 'string', description: 'Workspace path.' },
            },
          },
          permissions: ['filesystem.write'],
          sideEffects: ['writes workspace files'],
        },
        {
          name: 'read_file',
          label: 'Read File',
          description: 'Read a file in the workspace.',
          parameters: {
            type: 'object',
            required: ['path'],
            properties: {
              path: { type: 'string', description: 'Workspace path.' },
            },
          },
        },
      ],
      projectContextFiles: [
        {
          path: 'docs/context-runtime-kit/README.md',
          content: 'CRK docs must stay selector-backed.',
        },
        {
          path: 'AGENTS.md',
          content: 'Use corepack pnpm.\nDo not add UI for this task.',
        },
      ],
      skillsMetadata: [
        {
          id: 'verification-before-completion',
          title: 'Verification Before Completion',
          summary: 'Run fresh verification before completion claims.',
          triggers: ['completion', 'claim'],
          requiredWorkflow: ['identify command', 'run command', 'read output'],
          safetyRules: ['Do not claim success without evidence.'],
          examples: ['corepack pnpm run typecheck'],
          source: 'Evidence before assertions.',
        },
      ],
    });

    expect(input.sources.map((source) => `${source.kind}:${source.id}`)).toEqual([
      'project_rule:agents-md',
      'project_rule:docs-context-runtime-kit-readme-md',
      'skill:verification-before-completion',
      'toolset:runtime-tools',
    ]);
    expect(input.sources.at(-1)).toMatchObject({
      kind: 'toolset',
      id: 'runtime-tools',
      version: 'active',
      tools: [
        expect.objectContaining({ name: 'read_file' }),
        expect.objectContaining({ name: 'write_file' }),
      ],
    });
    const toolset = input.sources.at(-1);
    if (!toolset || toolset.kind !== 'toolset') {
      throw new Error('Expected runtime toolset source.');
    }
    expect(toolset.tools[1]).toMatchObject({
      name: 'write_file',
      inputSchema: {
        required: ['content', 'path'],
        properties: {
          content: { type: 'string', description: 'File content.' },
          mode: { type: 'string', enum: ['append', 'overwrite'], default: 'overwrite' },
          path: { type: 'string', description: 'Workspace path.' },
        },
      },
      permissions: ['filesystem.write'],
      sideEffects: ['writes workspace files'],
    });
    const agentsRules = input.sources[0];
    expect(agentsRules).toMatchObject({
      kind: 'project_rule',
      id: 'agents-md',
      rules: [
        { selector: 'rule:context_file.agents-md.line-1', text: 'Use corepack pnpm.' },
        { selector: 'rule:context_file.agents-md.line-2', text: 'Do not add UI for this task.' },
      ],
    });
  });
});
