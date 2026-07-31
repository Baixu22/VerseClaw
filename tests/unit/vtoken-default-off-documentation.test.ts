// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('FP-P4-06 VToken default-off documentation authority', () => {
  it('keeps active specifications aligned on default-off opt-in behavior', () => {
    const taskSpec = read('harness/specs/tasks/vtoken-foundation-bridge.md');
    const rule = read('harness/specs/rules/vtoken-foundation-boundary.md');
    const hostReadme = read('packages/vtoken/README.HOST.md');

    expect(taskSpec).toContain('Product default **OFF**');
    expect(taskSpec).not.toContain('Product default **ON**');
    expect(rule).toContain('default OFF');
    expect(rule).toContain('Do not claim product default-on');
    expect(hostReadme).toContain('Production path (default OFF');
    expect(hostReadme).toContain('runtime.vtoken.assembly.enabled=true');
    expect(hostReadme).toContain('runtime.vtoken.assembly.enabled=false');
    expect(hostReadme).not.toMatch(/^untime\.vtoken/m);
  });

  it('preserves the historical P1 claims with an adjacent authoritative correction', () => {
    const historical = read('docs/dev/dcs-visible-production/tasks/TASK-P1-04.md');

    expect(historical).toContain('VERSE_VTOKEN_ASSEMBLY_ENABLED` default 1');
    expect(historical).toContain('default on unless killed');
    expect(historical).toContain('FP-P4-06 correction');
    expect(historical).toContain('docs/dev/default-config-matrix.md');
    expect(historical).toContain('tasks/FP-P0-01.md');
  });

  it('does not leave the known developer-facing source comments claiming default-on', () => {
    const comments = [
      read('shared/vtoken/types.ts'),
      read('electron/services/vtoken-bridge.ts'),
    ].join('\n');

    expect(comments).not.toMatch(/(?:production assembly|product default)[^\n]*default ON/i);
    expect(comments).toMatch(/default OFF/i);
  });
});
