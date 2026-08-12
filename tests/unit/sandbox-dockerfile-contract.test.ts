import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const sandboxDockerfilePath = resolve(
  repoRoot,
  'openclaw_runtime/scripts/docker/sandbox/Dockerfile',
);

describe('sandbox Dockerfile contract', () => {
  it('provides the base image referenced by both sandbox setup entry points', async () => {
    const [dockerfile, standaloneSetup, dockerSetup] = await Promise.all([
      readFile(sandboxDockerfilePath, 'utf8'),
      readFile(resolve(repoRoot, 'openclaw_runtime/scripts/sandbox-setup.sh'), 'utf8'),
      readFile(resolve(repoRoot, 'openclaw_runtime/scripts/docker/setup.sh'), 'utf8'),
    ]);

    expect(standaloneSetup).toContain('scripts/docker/sandbox/Dockerfile');
    expect(dockerSetup).toContain('scripts/docker/sandbox/Dockerfile');
    expect(dockerfile).toMatch(/^FROM debian:bookworm-slim@sha256:[a-f0-9]{64}$/m);
    expect(dockerfile).toContain('python3');
    expect(dockerfile).toContain('ripgrep');
    expect(dockerfile).toContain('USER sandbox');
    expect(dockerfile).toContain('WORKDIR /home/sandbox');
  });
});
