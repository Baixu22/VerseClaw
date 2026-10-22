import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PERMISSION_EFFECT_COMPONENTS,
  permissionEffectBindingFor,
} from '@shared/permission-effect-contract';

const root = path.resolve(import.meta.dirname, '../..');

const wiring = [
  ['browser', ['electron/services/agent-browser-api.ts']],
  ['exec', [
    'openclaw_runtime/src/agents/bash-tools.exec-permission.ts',
    'openclaw_runtime/src/agents/bash-tools.exec-runtime.ts',
    'openclaw_runtime/src/agents/bash-tools.exec-host-node.ts',
  ]],
  ['knowledge-apply', ['electron/services/knowledge-api.ts']],
  ['fact-tools', ['openclaw_runtime/src/agents/tools/context-agent-tools.ts']],
  ['memory-write', ['openclaw_runtime/src/memory/memory-store.ts']],
  ['coding-control', ['openclaw_runtime/src/agents/stage4-tool-guard.ts']],
] as const;

function readSources(relativePaths: readonly string[]): string {
  return relativePaths
    .map((relativePath) => readFileSync(path.join(root, relativePath), 'utf8'))
    .join('\n');
}

describe('permission/effect production wiring', () => {
  it('covers every registered side-effect component at one final production checkpoint', () => {
    expect(wiring.map(([component]) => component).sort()).toEqual(
      [...PERMISSION_EFFECT_COMPONENTS].sort(),
    );
    for (const [component, relativePaths] of wiring) {
      const source = readSources(relativePaths);
      expect(
        source.includes(`permissionEffectBindingFor('${component}')`) ||
          source.includes(`permissionEffectBindingFor("${component}")`),
        relativePaths.join(', '),
      ).toBe(true);
      expect(
        source.includes('assertPermissionEffectOwnerCheckpoint') ||
          source.includes('assertPermissionEffectAtFinalCheckpoint') ||
          source.includes('assertExecPermissionEffect'),
        relativePaths.join(', '),
      ).toBe(true);
      expect(permissionEffectBindingFor(component)).toBeDefined();
    }
  });

  it('routes both browser entry points through the shared checkpoint', () => {
    const bridge = readFileSync(
      path.join(root, 'electron/gateway/agent-browser-bridge.ts'),
      'utf8',
    );
    expect(bridge).toContain('assertAgentBrowserPermissionEffect({');
    expect(
      readFileSync(path.join(root, 'electron/services/agent-browser-api.ts'), 'utf8'),
    ).toContain('assertPermissionEffectOwnerCheckpoint({');
  });

  it('keeps the exec backend from minting its own permission evidence', () => {
    const runtime = readFileSync(
      path.join(root, 'openclaw_runtime/src/agents/bash-tools.exec-runtime.ts'),
      'utf8',
    );
    expect(runtime).toContain('permissionEffect: PermissionEffectOwnerCheckpointInput');
    expect(runtime).toContain('assertExecPermissionEffect(opts.permissionEffect)');
    expect(runtime).not.toContain('createExecPermissionEffect(opts.permissionEffect)');
  });
});