import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isPluginLifecycleTask,
  loadGuideSpecs,
  loadLayerSpecs,
  parseFrontmatter,
  pathMatchesAny,
} from '../../harness/src/specs.mjs';
import { buildContext } from '../../harness/src/context.mjs';
import {
  scanBackendCommunicationBoundary,
  scanBackendCommunicationBoundaryText,
  touchesCommunicationPath,
  classifyChangedPathOwnership,
  validateChangedPathOwnership,
  validateGatewayTaskSpec,
  validatePluginLifecycleTaskSpec,
} from '../../harness/src/rules.mjs';

describe('harness specs', () => {
  it('parses Markdown frontmatter with arrays and nested docs', () => {
    const spec = parseFrontmatter(`---
id: example
requiredProfiles:
  - fast
  - comms
docs:
  required: false
---

Body`);

    expect(spec.data.id).toBe('example');
    expect(spec.data.requiredProfiles).toEqual(['fast', 'comms']);
    expect(spec.data.docs).toEqual({ required: false });
  });

  it('matches repository glob paths', () => {
    expect(pathMatchesAny('src/stores/chat/history-actions.ts', ['src/stores/chat/**'])).toBe(true);
    expect(pathMatchesAny('src/lib/host-api.ts', ['src/lib/host-api.ts'])).toBe(true);
    expect(pathMatchesAny('src/pages/Chat/index.tsx', ['electron/gateway/**'])).toBe(false);
  });

  it('loads guide and layer specs from the harness spec library', async () => {
    const guides = await loadGuideSpecs();
    const layers = await loadLayerSpecs();

    expect(guides.map((spec: { data: { id: string } }) => spec.data.id)).toEqual(
      expect.arrayContaining(['agent-harness-routing', 'spec-update']),
    );
    expect(layers.map((spec: { data: { id: string } }) => spec.data.id)).toEqual(
      expect.arrayContaining(['electron-main', 'harness', 'openclaw-runtime', 'plugins', 'renderer']),
    );
  });

  it('builds task context from scenario rules and touched-path layers', async () => {
    const context = await buildContext('harness/specs/tasks/connect-clawx-to-openclaw-runtime.md');

    expect(context.missingRules).toEqual([]);
    expect(context.missingScenarios).toEqual([]);
    expect(context.scenarios.map((spec: { data: { id: string } }) => spec.data.id)).toContain('gateway-backend-communication');
    expect(context.rules.map((spec: { data: { id: string } }) => spec.data.id)).toEqual(
      expect.arrayContaining(['renderer-main-boundary', 'backend-communication-boundary']),
    );
    expect(context.guides.map((spec: { data: { id: string } }) => spec.data.id)).toEqual(
      expect.arrayContaining(['agent-harness-routing', 'spec-update']),
    );
    expect(context.layers.map((spec: { data: { id: string } }) => spec.data.id)).toEqual(
      expect.arrayContaining(['electron-main', 'harness', 'openclaw-runtime']),
    );
    expect(context.layers.map((spec: { data: { id: string } }) => spec.data.id)).not.toContain('renderer');
    expect(context.readOrder[0].path.replaceAll('\\', '/')).toBe(
      'harness/specs/tasks/connect-clawx-to-openclaw-runtime.md',
    );
  });

  it('requires gateway backend communication tasks to run fast and comms', () => {
    const taskSpec = {
      path: 'harness/specs/tasks/example.md',
      data: {
        id: 'example',
        title: 'Example',
        scenario: 'gateway-backend-communication',
        taskType: 'runtime-bridge',
        intent: 'Adjust backend communication.',
        touchedAreas: ['src/lib/host-api.ts'],
        expectedUserBehavior: ['Visible state remains consistent.'],
        requiredProfiles: ['fast'],
        acceptance: ['Comms compare passes.'],
        docs: { required: false },
      },
    };
    const scenarioSpec = {
      data: {
        requiredProfiles: ['fast', 'comms'],
        ownedPaths: ['src/lib/host-api.ts'],
      },
    };

    expect(validateGatewayTaskSpec(taskSpec, scenarioSpec)).toContain(
      'harness/specs/tasks/example.md: requiredProfiles must include "comms"',
    );
  });

  it('detects plugin lifecycle task specs for strict validation', () => {
    expect(isPluginLifecycleTask({
      data: {
        scenario: 'plugin-lifecycle-management',
      },
    })).toBe(true);
    expect(isPluginLifecycleTask({
      data: {
        scenarios: ['plugin-lifecycle-management'],
      },
    })).toBe(true);
    expect(isPluginLifecycleTask({
      data: {
        scenario: 'gateway-backend-communication',
      },
    })).toBe(false);
  });

  it('requires plugin lifecycle tasks to declare strict task fields', () => {
    const taskSpec = {
      path: 'harness/specs/tasks/plugin-example.md',
      data: {
        id: 'plugin-example',
        title: 'Plugin Example',
        scenario: 'plugin-lifecycle-management',
        taskType: 'plugin-lifecycle',
        intent: 'Adjust plugin lifecycle behavior.',
        requiredProfiles: [],
        docs: { required: false },
      },
    };
    const scenarioSpec = {
      data: {
        requiredProfiles: ['fast'],
        ownedPaths: ['electron/utils/plugin-install.ts'],
      },
    };

    expect(validatePluginLifecycleTaskSpec(taskSpec, scenarioSpec)).toEqual(
      expect.arrayContaining([
        'harness/specs/tasks/plugin-example.md: requiredProfiles must include "fast"',
        'harness/specs/tasks/plugin-example.md: touchedAreas must declare affected paths',
        'harness/specs/tasks/plugin-example.md: expectedUserBehavior must declare visible behavior',
        'harness/specs/tasks/plugin-example.md: acceptance must declare completion criteria',
      ]),
    );
  });

  it('rejects plugin lifecycle tasks with the wrong scenario or task type', () => {
    const taskSpec = {
      path: 'harness/specs/tasks/plugin-example.md',
      data: {
        id: 'plugin-example',
        title: 'Plugin Example',
        scenario: 'gateway-backend-communication',
        taskType: 'runtime-bridge',
        intent: 'Adjust plugin lifecycle behavior.',
        touchedAreas: ['electron/utils/plugin-install.ts'],
        expectedUserBehavior: ['Plugin remains usable.'],
        requiredProfiles: ['fast'],
        acceptance: ['Validation passes.'],
        docs: { required: false },
      },
    };

    expect(validatePluginLifecycleTaskSpec(taskSpec, null)).toEqual(
      expect.arrayContaining([
        'harness/specs/tasks/plugin-example.md: plugin lifecycle tasks must set scenario: plugin-lifecycle-management',
        'harness/specs/tasks/plugin-example.md: plugin lifecycle tasks must set taskType: plugin-lifecycle',
      ]),
    );
  });

  it('detects communication path changes', () => {
    expect(touchesCommunicationPath(['electron/gateway/manager.ts'])).toBe(true);
    expect(touchesCommunicationPath(['README.md'])).toBe(false);
  });

  it('blocks direct Gateway HTTP in renderer files', async () => {
    const failures = await scanBackendCommunicationBoundary(['src/pages/Chat/index.tsx']);
    expect(failures).toEqual([]);
  });

  it('blocks direct IPC and Gateway transport calls in renderer text', () => {
    expect(scanBackendCommunicationBoundaryText(
      'src/pages/Chat/BadPanel.tsx',
      "window.electron.ipcRenderer.invoke('chat:send')",
    )).toEqual([
      'src/pages/Chat/BadPanel.tsx: renderer page/component must not call window.electron.ipcRenderer.invoke directly',
    ]);

    expect(scanBackendCommunicationBoundaryText(
      'src/stores/chat/bad-direct-fetch.ts',
      "await fetch('http://[::1]:18789/rpc')",
    )).toEqual([
      'src/stores/chat/bad-direct-fetch.ts: renderer must not fetch Gateway HTTP directly',
    ]);

    expect(scanBackendCommunicationBoundaryText(
      'src/lib/bad-gateway-ws.ts',
      'const ws = new WebSocket("ws://[::1]:18789/events")',
    )).toEqual([
      'src/lib/bad-gateway-ws.ts: renderer must not open Gateway WebSocket connections directly',
    ]);
  });

  it('allows fallback flags only in their boundary modules', async () => {
    const failures = await scanBackendCommunicationBoundary([
      'src/lib/host-api-client.ts',
      'src/lib/host-api.ts',
      'src/lib/host-events.ts',
    ]);
    expect(failures).toEqual([]);
  });

  it('allows pages and components to display gatewayReady state', async () => {
    const failures = await scanBackendCommunicationBoundary(['src/components/layout/Sidebar.tsx']);
    expect(failures).toEqual([]);
  });

  // RC-00R regression. Scenario-less task specs (the RC-00..RC-09 convergence
  // packages) previously reached only the id/title branch in cli.mjs, so their
  // declared ownedPaths were inert and any changed path validated clean. These
  // cases pin the ownership check to the task spec itself.
  describe('changed-path ownership', () => {
    const spec = {
      path: 'harness/specs/tasks/example.md',
      data: {
        id: 'example',
        title: 'Example',
        touchedAreas: ['scripts/**'],
        ownedPaths: ['tests/unit/example.test.ts'],
      },
    };

    it('accepts changed paths covered by touchedAreas or the task spec ownedPaths', () => {
      expect(validateChangedPathOwnership(spec, null, [
        'scripts/lib/thing.mjs',
        'tests/unit/example.test.ts',
      ])).toEqual([]);
    });

    it('rejects a changed path owned by no declared area', () => {
      const failures = validateChangedPathOwnership(spec, null, [
        'scripts/lib/thing.mjs',
        'openclaw_runtime/src/agents/receipt-store.ts',
      ]);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('openclaw_runtime/src/agents/receipt-store.ts');
      expect(failures[0]).not.toContain('scripts/lib/thing.mjs');
    });

    it('still honours scenario ownedPaths for scenario-bound specs', () => {
      expect(validateChangedPathOwnership(spec, {
        data: { ownedPaths: ['openclaw_runtime/src/agents/receipt-store.ts'] },
      }, ['openclaw_runtime/src/agents/receipt-store.ts'])).toEqual([]);
    });

    it('fails closed when a spec declares no ownership at all but files changed', () => {
      const bare = { path: 'harness/specs/tasks/bare.md', data: { id: 'bare', title: 'Bare' } };
      expect(validateChangedPathOwnership(bare, null, ['scripts/x.mjs'])).toHaveLength(1);
      // No changed files is the only case that legitimately produces no failure.
      expect(validateChangedPathOwnership(bare, null, [])).toEqual([]);
    });

    it('classifies only the exact Task Forest export paths as residual', () => {
      const residualPaths = [
        '.agent-workbench/task-forest/exports/task-forest.graph.json',
        '.agent-workbench/task-forest/exports/task-forest.html',
        '.agent-workbench/task-forest/graph/forest.json',
      ];
      const specWithResidual = {
        ...spec,
        data: { ...spec.data, residualPaths },
      };
      const ownership = classifyChangedPathOwnership(specWithResidual, null, residualPaths);

      expect(ownership.residual).toEqual(residualPaths);
      expect(ownership.uncovered).toEqual([]);
      expect(ownership.allowedPaths).not.toContain('.agent-workbench/task-forest/**');
      expect(validateChangedPathOwnership(specWithResidual, null, residualPaths)).toEqual([]);
      expect(validateChangedPathOwnership(
        { path: 'harness/specs/tasks/residual-only.md', data: { residualPaths } },
        null,
        residualPaths,
      )).toEqual([]);
    });

    it('keeps near-miss Task Forest paths fail-closed', () => {
      const specWithResidual = {
        ...spec,
        data: {
          ...spec.data,
          residualPaths: [
            '.agent-workbench/task-forest/exports/task-forest.graph.json',
            '.agent-workbench/task-forest/exports/task-forest.html',
            '.agent-workbench/task-forest/graph/forest.json',
          ],
        },
      };
      const nearMisses = [
        '.agent-workbench/task-forest/other.json',
        '.agent-workbench/task-forest/graph/other.json',
      ];
      const ownership = classifyChangedPathOwnership(specWithResidual, null, nearMisses);

      expect(ownership.residual).toEqual([]);
      expect(ownership.uncovered).toEqual(nearMisses);
      expect(validateChangedPathOwnership(specWithResidual, null, nearMisses)[0]).toContain(
        nearMisses.join(', '),
      );
    });

    it.each([
      ['**'],
      ['src/**'],
      ['*'],
      ['?'],
      ['[abc]'],
      ['{a,b}'],
      ['../secret.txt'],
      ['C:\\secret.txt'],
      ['C:/secret.txt'],
      ['/abs/secret.txt'],
      ['.'],
      ['..'],
      [''],
      ['src/'],
      ['src'],
      ['./nested/file.txt'],
      ['src\\file.txt'],
    ])('rejects non-exact residualPaths entry %j', (entry) => {
      const specWithResidual = {
        ...spec,
        data: { ...spec.data, residualPaths: [entry] },
      };
      const failures = validateChangedPathOwnership(specWithResidual, null, []);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain('residualPaths must be exact');
      expect(failures[0]).toContain(JSON.stringify(entry));
      // An invalid entry must never classify a changed file as residual.
      const ownership = classifyChangedPathOwnership(specWithResidual, null, ['anything.txt']);
      expect(ownership.residual).toEqual([]);
    });

    it('fails closed with a non-zero exit when a spec declares residualPaths: ["**"]', () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), 'harness-residual-glob-cli-'));
      try {
        cpSync(join(process.cwd(), 'harness', 'src'), join(fixtureRoot, 'harness', 'src'), {
          recursive: true,
        });
        mkdirSync(join(fixtureRoot, 'harness', 'specs', 'tasks'), { recursive: true });
        writeFileSync(join(fixtureRoot, 'harness', 'specs', 'tasks', 'residual-glob-fixture.md'), `---
id: residual-glob-fixture
title: Residual glob fixture
touchedAreas:
  - owned.txt
residualPaths:
  - "**"
---
`, 'utf8');
        writeFileSync(join(fixtureRoot, 'owned.txt'), 'base\n', 'utf8');

        execFileSync('git', ['init', '--quiet'], { cwd: fixtureRoot });
        execFileSync('git', ['config', 'user.email', 'harness-fixture@example.invalid'], { cwd: fixtureRoot });
        execFileSync('git', ['config', 'user.name', 'Harness Fixture'], { cwd: fixtureRoot });
        execFileSync('git', ['add', '.'], { cwd: fixtureRoot });
        execFileSync('git', ['commit', '--quiet', '-m', 'fixture base'], { cwd: fixtureRoot });

        writeFileSync(join(fixtureRoot, 'anything.txt'), 'changed\n', 'utf8');
        const result = spawnSync(
          process.execPath,
          [
            join(fixtureRoot, 'harness', 'src', 'cli.mjs'),
            'validate',
            '--spec',
            'harness/specs/tasks/residual-glob-fixture.md',
            '--since',
            'HEAD',
          ],
          { cwd: fixtureRoot, encoding: 'utf8' },
        );
        const output = `${result.stdout}\n${result.stderr}`;

        expect(result.status).toBe(1);
        expect(output).toContain('residualPaths must be exact');
        expect(output).toContain('**');
        expect(output).not.toContain('PASS WITH RESIDUAL');
        expect(output).not.toContain('Spec is valid');
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3 });
      }
    });

    it('returns non-zero when a residual is accompanied by another uncovered path', () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), 'harness-residual-cli-'));
      try {
        cpSync(join(process.cwd(), 'harness', 'src'), join(fixtureRoot, 'harness', 'src'), {
          recursive: true,
        });
        mkdirSync(join(fixtureRoot, 'harness', 'specs', 'tasks'), { recursive: true });
        writeFileSync(join(fixtureRoot, 'harness', 'specs', 'tasks', 'residual-fixture.md'), `---
id: residual-fixture
title: Residual fixture
touchedAreas:
  - owned.txt
residualPaths:
  - .agent-workbench/task-forest/exports/task-forest.graph.json
---

# Residual fixture
`, 'utf8');
        writeFileSync(join(fixtureRoot, 'owned.txt'), 'base\n', 'utf8');

        execFileSync('git', ['init', '--quiet'], { cwd: fixtureRoot });
        execFileSync('git', ['config', 'user.email', 'harness-fixture@example.invalid'], { cwd: fixtureRoot });
        execFileSync('git', ['config', 'user.name', 'Harness Fixture'], { cwd: fixtureRoot });
        execFileSync('git', ['add', '.'], { cwd: fixtureRoot });
        execFileSync('git', ['commit', '--quiet', '-m', 'fixture base'], { cwd: fixtureRoot });

        mkdirSync(join(fixtureRoot, '.agent-workbench', 'task-forest', 'exports'), { recursive: true });
        writeFileSync(
          join(fixtureRoot, '.agent-workbench', 'task-forest', 'exports', 'task-forest.graph.json'),
          '{}\n',
          'utf8',
        );
        writeFileSync(join(fixtureRoot, 'other.json'), '{}\n', 'utf8');
        const result = spawnSync(
          process.execPath,
          [
            join(fixtureRoot, 'harness', 'src', 'cli.mjs'),
            'validate',
            '--spec',
            'harness/specs/tasks/residual-fixture.md',
            '--since',
            'HEAD',
          ],
          { cwd: fixtureRoot, encoding: 'utf8' },
        );
        const output = `${result.stdout}\n${result.stderr}`;

        expect(result.status).toBe(1);
        expect(output).toContain('RESIDUAL: residualPaths=.agent-workbench/task-forest/exports/task-forest.graph.json');
        expect(output).toContain('other.json');
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3 });
      }
    });

    it('runs the CLI ownership branch for a scenario-less spec', () => {
      const fixtureRoot = mkdtempSync(join(tmpdir(), 'harness-cli-f4-'));
      try {
        cpSync(join(process.cwd(), 'harness', 'src'), join(fixtureRoot, 'harness', 'src'), {
          recursive: true,
        });
        mkdirSync(join(fixtureRoot, 'harness', 'specs', 'tasks'), { recursive: true });
        writeFileSync(join(fixtureRoot, 'harness', 'specs', 'tasks', 'scenario-less.md'), `---
id: scenario-less-fixture
title: Scenario-less fixture
touchedAreas:
  - owned.txt
---

# Scenario-less fixture
`, 'utf8');
        writeFileSync(join(fixtureRoot, 'owned.txt'), 'base\n', 'utf8');

        execFileSync('git', ['init', '--quiet'], { cwd: fixtureRoot });
        execFileSync('git', ['config', 'user.email', 'harness-fixture@example.invalid'], { cwd: fixtureRoot });
        execFileSync('git', ['config', 'user.name', 'Harness Fixture'], { cwd: fixtureRoot });
        execFileSync('git', ['add', '.'], { cwd: fixtureRoot });
        execFileSync('git', ['commit', '--quiet', '-m', 'fixture base'], { cwd: fixtureRoot });

        writeFileSync(join(fixtureRoot, 'unowned-change.txt'), 'unowned\n', 'utf8');
        const result = spawnSync(
          process.execPath,
          [join(fixtureRoot, 'harness', 'src', 'cli.mjs'), 'validate', '--spec', 'harness/specs/tasks/scenario-less.md', '--since', 'HEAD'],
          { cwd: fixtureRoot, encoding: 'utf8' },
        );
        const output = `${result.stdout}\n${result.stderr}`;

        expect(result.status).toBe(1);
        expect(output).toContain('changed files are not covered by touchedAreas or ownedPaths');
        expect(output).toContain('unowned-change.txt');
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3 });
      }
    });
  });
});
