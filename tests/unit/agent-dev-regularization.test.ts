import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CHECKS, REQUIRED_SCENARIOS, runConformance } from '../../scripts/channel-conformance.mjs';
import { renderHtml } from '../../scripts/agent-dev-workbench.mjs';
import { assertLooksRedacted } from '../../scripts/agent-dev-promote-scenario.mjs';
import {
  buildAuditReport,
  maturityLevelForScore,
  parseAuditArgs,
  collectGitSourceState,
  resolveSourceChangeTimeMs,
} from '../../scripts/agent-dev-audit.mjs';
import {
  REQUIRED_BUILD_ARTIFACTS,
  PERFORMANCE_BUDGETS,
  analyzeBuildOutput,
  analyzePlaywrightOutput,
  analyzeStepOutput,
  analyzeTypecheckOutput,
  assessBuildReuse,
  classifyPerformanceLimits,
  createHistoryEntry,
  createDeepTestPlan,
  createFreshBuildReuse,
  parseDeepTestArgs,
  summarizeDeepTestDecision,
  summarizeGateProfile,
  summarizeTrend,
} from '../../scripts/agent-dev-deep-test.mjs';
import {
  createEmptyCostUsage,
  type AgentDevSkillSandboxReport,
  type AgentDevTraceEvent,
} from '@shared/agent-dev/trace-contract';

const execFileAsync = promisify(execFile);

type Identified = { id: string; status?: string; severity?: string; args?: unknown; findings?: unknown };

describe('agent dev regularization contracts', () => {
  async function writeFileWithMtime(path: string, content: string, date: Date) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, content, 'utf8');
    await utimes(path, date, date);
  }

  async function writeBuildArtifacts(root: string, date: Date) {
    for (const artifact of REQUIRED_BUILD_ARTIFACTS) {
      await writeFileWithMtime(join(root, artifact), 'built\n', date);
    }
  }

  it('defines the required channel conformance matrix', () => {
    // RC-05: the matrix is the set of executable scenarios the fixture must
    // prove, not a source-regex checklist.
    expect(REQUIRED_SCENARIOS).toEqual([
      'connection drop',
      'rate limiting',
      'duplicate delivery',
      'restart recovery',
      'denial produces zero effect',
      'unknown outcome',
    ]);
    expect(CHECKS.map((check: Identified) => check.id)).toEqual([
      'connection-drop',
      'rate-limiting',
      'duplicate-delivery',
      'restart-recovery',
      'denial-produces-zero-effect',
      'unknown-outcome',
    ]);
  });

  // The runner spawns a full `pnpm --dir openclaw_runtime exec vitest` child
  // (channel-conformance.mjs runFixtureSuite), which takes ~10-15s on this
  // machine — far beyond vitest's 5s default. Explicit timeout instead of
  // betting on machine speed: this pre-existing timeout aborted agent-dev
  // deep-test before its playwright step (R6 prerequisite cleanup).
  it('writes fail-closed channel conformance reports for a scaffold-shaped channel', async () => {
    const originalRoot = process.env.CLAWX_CHANNEL_CONFORMANCE_ROOT;
    const originalArtifactRoot = process.env.CLAWX_CHANNEL_CONFORMANCE_ARTIFACT_ROOT;
    const root = join(tmpdir(), `clawx-channel-conformance-${Date.now()}`);
    const channelRoot = join(root, 'smoke-channel');
    await mkdir(join(channelRoot, '__tests__'), { recursive: true });
    await writeFile(join(channelRoot, 'adapter.ts'), 'export async function sendText() {}\nexport async function receiveText() {}\n', 'utf8');
    await writeFile(join(channelRoot, 'schema.yaml'), 'message:\n  type: object\n  required:\n    - text\n  properties:\n    text:\n      type: string\n', 'utf8');
    await writeFile(join(channelRoot, 'manifest.yaml'), 'capabilities:\n  - channel.send\n  - channel.receive\ndiagnostics:\n  logs: true\n', 'utf8');
    await writeFile(join(channelRoot, '__tests__', 'conformance.test.ts'), 'sendText(); receiveText(); connection drop;\n', 'utf8');

    process.env.CLAWX_CHANNEL_CONFORMANCE_ROOT = root;
    process.env.CLAWX_CHANNEL_CONFORMANCE_ARTIFACT_ROOT = join(root, 'artifacts');
    try {
      const report = await runConformance('smoke-channel');
      // RC-05: a scaffold without an executable conformance suite is NOT proof.
      // The runner fails closed (no executed scenarios) instead of passing on
      // source-regex matches.
      expect(report.success).toBe(false);
      expect(report.scenarios).toHaveLength(REQUIRED_SCENARIOS.length);
      expect(report.scenarios.every((check: Identified) => check.status === 'fail')).toBe(true);
    } finally {
      if (originalRoot === undefined) {
        delete process.env.CLAWX_CHANNEL_CONFORMANCE_ROOT;
      } else {
        process.env.CLAWX_CHANNEL_CONFORMANCE_ROOT = originalRoot;
      }
      if (originalArtifactRoot === undefined) {
        delete process.env.CLAWX_CHANNEL_CONFORMANCE_ARTIFACT_ROOT;
      } else {
        process.env.CLAWX_CHANNEL_CONFORMANCE_ARTIFACT_ROOT = originalArtifactRoot;
      }
    }
  }, 120_000);

  it('scaffolds scenarios into the shared registry and snapshot-backed E2E', async () => {
    const root = join(tmpdir(), `clawx-agent-dev-scenario-scaffold-${Date.now()}`);
    await mkdir(join(root, 'shared', 'agent-dev'), { recursive: true });
    await writeFile(join(root, 'shared', 'agent-dev', 'scenarios.ts'), `export type AgentDevScenarioDefinition = {
  id: string;
  route: string;
  description: string;
  seed: Record<string, unknown>;
  slices?: string[];
  tags?: string[];
};

export const AGENT_DEV_SCENARIOS = [
  {
    id: 'chat-empty',
    route: '/',
    description: 'Empty chat session.',
    seed: {},
  },
] as const satisfies readonly AgentDevScenarioDefinition[];
`, 'utf8');

    try {
      await execFileAsync(process.execPath, [
        join(process.cwd(), 'scripts', 'agent-dev-scaffold.mjs'),
        'scenario',
        'Smoke Scenario',
      ], { cwd: root });

      const registry = await readFile(join(root, 'shared', 'agent-dev', 'scenarios.ts'), 'utf8');
      const e2e = await readFile(join(root, 'tests', 'e2e', 'smoke-scenario.spec.ts'), 'utf8');

      expect(registry).toContain("id: 'smoke-scenario'");
      expect(registry).toContain("tags: ['scaffold']");
      expect(e2e).toContain('getAgentDevSnapshot');
      expect(e2e).toContain("devScenario: 'smoke-scenario'");

      await expect(execFileAsync(process.execPath, [
        join(process.cwd(), 'scripts', 'agent-dev-scaffold.mjs'),
        'scenario',
        'Smoke Scenario',
      ], { cwd: root })).rejects.toThrow(/Refusing to overwrite existing file/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses standalone E2E scaffolds for unregistered scenarios', async () => {
    const root = join(tmpdir(), `clawx-agent-dev-e2e-scaffold-${Date.now()}`);
    await mkdir(join(root, 'shared', 'agent-dev'), { recursive: true });
    await writeFile(join(root, 'shared', 'agent-dev', 'scenarios.ts'), `export type AgentDevScenarioDefinition = {
  id: string;
  route: string;
  description: string;
  seed: Record<string, unknown>;
};

export const AGENT_DEV_SCENARIOS = [
  {
    id: 'registered-flow',
    route: '/',
    description: 'Registered flow.',
    seed: {},
  },
] as const satisfies readonly AgentDevScenarioDefinition[];
`, 'utf8');

    try {
      await expect(execFileAsync(process.execPath, [
        join(process.cwd(), 'scripts', 'agent-dev-scaffold.mjs'),
        'e2e',
        'Unregistered Flow',
      ], { cwd: root })).rejects.toThrow(/unregistered scenario/);

      await execFileAsync(process.execPath, [
        join(process.cwd(), 'scripts', 'agent-dev-scaffold.mjs'),
        'e2e',
        'Registered Flow',
      ], { cwd: root });
      const e2e = await readFile(join(root, 'tests', 'e2e', 'registered-flow.spec.ts'), 'utf8');
      expect(e2e).toContain("openAgentDevScenario(page, 'registered-flow')");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('scaffolds pages with four-locale namespace stubs', async () => {
    const root = join(tmpdir(), `clawx-agent-dev-page-scaffold-${Date.now()}`);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'App.tsx'), `import { lazy } from 'react';
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
function App() {
  return (
    <>
              <Route path="/settings/*" element={<Settings />} />
    </>
  );
}
`, 'utf8');

    try {
      await execFileAsync(process.execPath, [
        join(process.cwd(), 'scripts', 'agent-dev-scaffold.mjs'),
        'page',
        'Workbench Panel',
      ], { cwd: root });

      const page = await readFile(join(root, 'src', 'pages', 'WorkbenchPanel', 'index.tsx'), 'utf8');
      const app = await readFile(join(root, 'src', 'App.tsx'), 'utf8');
      expect(page).toContain("useTranslation('workbench-panel')");
      expect(app).toContain("const WorkbenchPanel = lazy(() => import('./pages/WorkbenchPanel')");
      expect(app).toContain('<Route path="/workbench-panel" element={<WorkbenchPanel />} />');
      for (const locale of ['en', 'zh', 'ja', 'ru']) {
        const localeStub = await readFile(
          join(root, 'shared', 'i18n', 'locales', locale, 'workbench-panel.json'),
          'utf8',
        );
        expect(localeStub).toContain('"title": "workbench-panel"');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('scaffolds host routes through contract, renderer facade, and Main registry', async () => {
    const root = join(tmpdir(), `clawx-agent-dev-host-route-scaffold-${Date.now()}`);
    await mkdir(join(root, 'electron', 'main'), { recursive: true });
    await mkdir(join(root, 'shared', 'host-api'), { recursive: true });
    await mkdir(join(root, 'src', 'lib'), { recursive: true });
    await writeFile(join(root, 'shared', 'host-api', 'contract.ts'), `export type HostSuccess = { success: true };
export type HostApiContract = {
  agentDev: {
    status: () => HostSuccess;
  };
  providers: {
    list: () => unknown[];
  };
};
`, 'utf8');
    await writeFile(join(root, 'src', 'lib', 'host-api.ts'), `import type {
  HostSuccess,
} from '@shared/host-api/contract';
import { invokeHost } from './host-api-client';
export const hostApi = {
  agentDev: {
    status: () => invokeHost('agentDev', 'status'),
  },
  providers: {
    list: () => invokeHost('providers', 'list'),
  },
};
`, 'utf8');
    await writeFile(join(root, 'electron', 'main', 'ipc-handlers.ts'), `import { createAgentDevApi } from '../services/agent-dev-api';
hostApiRegistry.registerCoreServices({
    agentDev: createAgentDevApi({ gatewayManager }),
    providers: createProvidersApi(),
});
`, 'utf8');

    try {
      await execFileAsync(process.execPath, [
        join(process.cwd(), 'scripts', 'agent-dev-scaffold.mjs'),
        'host-route',
        'Workbench Evidence',
      ], { cwd: root });

      const contract = await readFile(join(root, 'shared', 'host-api', 'contract.ts'), 'utf8');
      const hostApi = await readFile(join(root, 'src', 'lib', 'host-api.ts'), 'utf8');
      const ipc = await readFile(join(root, 'electron', 'main', 'ipc-handlers.ts'), 'utf8');
      const service = await readFile(join(root, 'electron', 'services', 'workbench-evidence-api.ts'), 'utf8');

      expect(contract).toContain('export type WorkbenchEvidencePingResult');
      expect(contract).toContain('workbenchEvidence: {');
      expect(hostApi).toContain("invokeHost('workbenchEvidence', 'ping')");
      expect(ipc).toContain('workbenchEvidence: createWorkbenchEvidenceApi()');
      expect(service).toContain("CompleteHostServiceRegistry['workbenchEvidence']");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('promotes reviewed scenario recordings into registry, fixture, harness, and E2E', async () => {
    const root = join(tmpdir(), `clawx-agent-dev-promote-${Date.now()}`);
    await mkdir(join(root, 'shared', 'agent-dev'), { recursive: true });
    await writeFile(join(root, 'shared', 'agent-dev', 'scenarios.ts'), `export type AgentDevScenarioDefinition = {
  id: string;
  route: string;
  description: string;
  seed: Record<string, unknown>;
  slices?: string[];
  tags?: string[];
};

export const AGENT_DEV_SCENARIOS = [
  {
    id: 'chat-empty',
    route: '/',
    description: 'Empty chat session.',
    seed: {},
  },
] as const satisfies readonly AgentDevScenarioDefinition[];
`, 'utf8');
    const artifactPath = join(root, 'recording.scenario.json');
    await writeFile(artifactPath, JSON.stringify({
      schema: 'clawx.agent-dev.scenario-recording.v1',
      capturedAt: '2026-01-01T00:00:00.000Z',
      route: '/settings/developer',
      seedState: { metadata: { apiKey: '[redacted]' } },
      review: { required: true },
    }, null, 2), 'utf8');

    try {
      await execFileAsync(process.execPath, [
        join(process.cwd(), 'scripts', 'agent-dev-promote-scenario.mjs'),
        artifactPath,
        'Recorded Developer Flow',
      ], { cwd: root });

      const registry = await readFile(join(root, 'shared', 'agent-dev', 'scenarios.ts'), 'utf8');
      const e2e = await readFile(join(root, 'tests', 'e2e', 'recorded-developer-flow.spec.ts'), 'utf8');
      const fixture = await readFile(join(root, 'tests', 'e2e', 'fixtures', 'agent-dev', 'recorded-developer-flow.scenario.json'), 'utf8');

      expect(registry).toContain("id: 'recorded-developer-flow'");
      expect(registry).toContain("route: '/settings/developer'");
      expect(registry).toContain("recordingFixture: 'tests/e2e/fixtures/agent-dev/recorded-developer-flow.scenario.json'");
      expect(e2e).toContain("devScenario: 'recorded-developer-flow'");
      expect(fixture).toContain('[redacted]');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unredacted scenario recordings before promotion', () => {
    expect(() => assertLooksRedacted('{"apiKey":"sk_unredacted_secret"}')).toThrow(/unredacted sensitive data/);
    expect(() => assertLooksRedacted('{"apiKey":"[redacted]"}')).not.toThrow();
  });

  it('escapes scenario metadata in the static workbench', () => {
    const html = renderHtml([
      {
        id: 'unsafe<script>',
        route: '/settings/models" onclick="bad',
        description: '<b>not markup</b>',
      },
    ], {
      scripts: {},
      artifacts: {
        quality: false,
        channelConformance: false,
        scenarioRecordings: false,
      },
    });

    expect(html).toContain('unsafe&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;not markup&lt;/b&gt;');
    expect(html).toContain('pnpm channel:conformance &lt;name&gt;');
    expect(html).not.toContain('<b>not markup</b>');
    expect(html).not.toContain('onclick="bad');
  });

  it('renders optimized Agent Dev gate commands and quality evidence in the static workbench', () => {
    const html = renderHtml([
      {
        id: 'chat-empty',
        route: '/',
        description: 'Empty chat session.',
      },
    ], {
      scripts: {
        'agent-dev:fast': 'pnpm contract:check && pnpm i18n:lint && pnpm agent-dev:unit',
        'test:e2e:agent-dev-quality:run': 'playwright test tests/e2e/agent-dev-quality.spec.ts --workers=2',
      },
      artifacts: {
        quality: true,
        channelConformance: false,
        scenarioRecordings: false,
      },
      gateCommands: {
        fastPr: ['pnpm agent-dev:fast'],
        fullLocal: ['pnpm run test:e2e:agent-dev-quality:run'],
        nightlyRelease: ['pnpm agent-dev:deep-test'],
      },
      performance: {
        latest: {
          totalDurationMs: 36914,
          decision: { status: 'needs-full-gate' },
          modes: {
            buildReuse: 'reused',
            unit: 'fast',
            typecheck: 'parallel',
            e2e: 'smoke',
          },
          bottlenecks: [{
            id: 'typecheck',
            durationMs: 20294,
            commandLine: 'pnpm run typecheck:agent-dev',
            skipped: false,
          }],
        },
        history: {
          entries: [{
            generatedAt: '2026-01-01T00:00:00.000Z',
            decisionStatus: 'needs-full-gate',
            totalDurationMs: 36914,
            modes: {
              buildReuse: 'reused',
              unit: 'fast',
              typecheck: 'parallel',
              e2e: 'smoke',
            },
          }],
        },
        audit: {
          status: 'pass',
          grade: 'A',
          totalScore: 97,
          maxScore: 100,
          disqualifierCount: 0,
          scoreBreakdown: [{
            status: 'pass',
            title: 'Gate Integrity',
            score: 20,
            maxScore: 20,
            deducted: 0,
          }],
        },
      },
    });

    expect(html).toContain('quality artifacts present');
    expect(html).toContain('pnpm agent-dev:fast');
    expect(html).toContain('pnpm run test:e2e:agent-dev-quality:run');
    expect(html).toContain('needs-full-gate');
    expect(html).toContain('pnpm run typecheck:agent-dev');
    expect(html).toContain('Gate Integrity');
  });

  it('keeps trace and sandbox reports typed for P2/P3 workbench surfaces', () => {
    const event: AgentDevTraceEvent = {
      id: 'trace-1',
      requestId: 'request-1',
      at: 1,
      layer: 'runtime',
      direction: 'internal',
      label: 'model call',
      durationMs: 12,
      metadata: { totalTokens: 42 },
    };
    const sandbox: AgentDevSkillSandboxReport = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      capabilityGate: {
        network: false,
        filesystem: false,
        'model-call': false,
        'channel-send': false,
      },
      budget: {
        tokenLimit: 100,
        apiCallLimit: 1,
        executionMsLimit: 1000,
        memoryMbLimit: 128,
      },
      effects: [],
    };

    expect(event.layer).toBe('runtime');
    expect(sandbox.capabilityGate.network).toBe(false);
    expect(createEmptyCostUsage()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    });
  });

  it('classifies Agent Dev gate performance limits with actionable loops', () => {
    const limits = classifyPerformanceLimits([
      {
        id: 'contract',
        durationMs: PERFORMANCE_BUDGETS.contract.targetMs - 1,
        commandLine: 'pnpm contract:check',
        goal: 'contract',
      },
      {
        id: 'typecheck',
        durationMs: PERFORMANCE_BUDGETS.typecheck.targetMs + 100,
        commandLine: 'pnpm run typecheck',
        goal: 'typecheck',
      },
      {
        id: 'e2e-build',
        durationMs: PERFORMANCE_BUDGETS['e2e-build'].limitMs + 100,
        commandLine: 'pnpm run build:vite',
        goal: 'build',
      },
    ]);

    expect(limits.map((entry: Identified) => [entry.id, entry.severity])).toEqual([
      ['e2e-build', 'limit'],
      ['typecheck', 'watch'],
      ['contract', 'ok'],
    ]);
    expect(limits[0]).toEqual(expect.objectContaining({
      loop: 'full-local',
      overLimitMs: 100,
    }));

    const profile = summarizeGateProfile(limits);
    expect(profile['full-local'].stepCount).toBe(2);
    expect(profile['fast-pr'].stepCount).toBe(1);
    expect(profile['full-local'].slowestStep).toEqual(expect.objectContaining({ id: 'e2e-build' }));
  });

  it('does not reuse a build when a required artifact is missing', async () => {
    const root = join(tmpdir(), `clawx-agent-dev-build-missing-${Date.now()}`);
    try {
      await mkdir(join(root, 'dist'), { recursive: true });
      await writeFile(join(root, 'dist', 'index.html'), '<!doctype html>\n', 'utf8');

      const reuse = await assessBuildReuse(root);

      expect(reuse).toEqual(expect.objectContaining({
        status: 'missing',
        reusable: false,
      }));
      expect(reuse.reason).toContain('missing');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not reuse a build when relevant source is newer than dist', async () => {
    const root = join(tmpdir(), `clawx-agent-dev-build-stale-${Date.now()}`);
    const oldDate = new Date('2026-01-01T00:00:00.000Z');
    const newDate = new Date('2026-01-02T00:00:00.000Z');
    try {
      await writeBuildArtifacts(root, oldDate);
      await writeFileWithMtime(join(root, 'src', 'App.tsx'), 'export const changed = true;\n', newDate);

      const reuse = await assessBuildReuse(root);

      expect(reuse).toEqual(expect.objectContaining({
        status: 'stale',
        reusable: false,
      }));
      expect(reuse.reason).toContain('src/App.tsx newer than');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reuses a build when dist artifacts are newer than relevant source', async () => {
    const root = join(tmpdir(), `clawx-agent-dev-build-reused-${Date.now()}`);
    const oldDate = new Date('2026-01-01T00:00:00.000Z');
    const newDate = new Date('2026-01-02T00:00:00.000Z');
    try {
      await writeFileWithMtime(join(root, 'src', 'App.tsx'), 'export const unchanged = true;\n', oldDate);
      await writeBuildArtifacts(root, newDate);

      const reuse = await assessBuildReuse(root);

      expect(reuse).toEqual(expect.objectContaining({
        status: 'reused',
        reusable: true,
      }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('classifies skipped build reuse steps without treating them as missing evidence', () => {
    const limits = classifyPerformanceLimits([
      {
        id: 'e2e-build',
        durationMs: 1,
        commandLine: 'reuse existing build',
        goal: 'build reuse',
        skipped: true,
        reuseStatus: 'reused',
      },
    ]);

    expect(limits[0]).toEqual(expect.objectContaining({
      id: 'e2e-build',
      severity: 'ok',
      skipped: true,
      reuseStatus: 'reused',
    }));
  });

  it('extracts structured deep-test diagnostics from command output', () => {
    const typecheck = analyzeTypecheckOutput(
      { commandLine: 'pnpm run typecheck:agent-dev' },
      `noise
{
  "success": true,
  "mode": "parallel",
  "totalDurationMs": 20000,
  "coverageNote": "same projects",
  "results": [
    { "commandLine": "pnpm run typecheck:node", "exitCode": 0, "durationMs": 10000 },
    { "commandLine": "pnpm run typecheck:web", "exitCode": 0, "durationMs": 20000 }
  ]
}`,
    );
    expect(typecheck).toEqual(expect.objectContaining({
      kind: 'typecheck',
      mode: 'parallel',
      slowestPhase: expect.objectContaining({ commandLine: 'pnpm run typecheck:web' }),
    }));

    const build = analyzeBuildOutput(`
dist/assets/index.js  1,440.46 kB │ gzip: 456.52 kB
dist-electron/main/index.js  834.50 kB │ gzip: 247.48 kB
✓ built in 24.81s
`, '(!) Some chunks are larger than 500 kB after minification.');
    expect(build.largestAssets[0]).toEqual(expect.objectContaining({
      path: 'dist/assets/index.js',
      sizeKb: 1440.46,
    }));
    expect(build.warningCount).toBeGreaterThan(0);

    const playwright = analyzePlaywrightOutput(`
  ok 1 tests\\e2e\\agent-dev-quality.spec.ts:55:7 › agent dev quality gates › loads Workbench (6.2s)
  ok 2 tests\\e2e\\agent-dev-quality.spec.ts:6:7 › agent dev quality gates › produces report (800ms)
  2 passed (7.1s)
`, '');
    expect(playwright).toEqual(expect.objectContaining({
      passed: 2,
      reportedDurationMs: 7100,
    }));
    expect(playwright.tests[0].durationMs).toBe(6200);

    expect(analyzeStepOutput(
      { id: 'e2e-build', commandLine: 'reuse existing build', skipped: true },
      '',
      '',
    ).build).toEqual(expect.objectContaining({
      reused: true,
      skipped: true,
    }));
  });

  it('keeps full deep-test commands by default and switches only requested fast paths', () => {
    const fullOptions = parseDeepTestArgs([]);
    const fullPlan = createDeepTestPlan(fullOptions, createFreshBuildReuse());
    expect(fullPlan.find((step: Identified) => step.id === 'typecheck')?.args).toEqual(['run', 'typecheck']);
    expect(fullPlan.find((step: Identified) => step.id === 'vitest-agent-dev')?.args).toEqual(['agent-dev:unit']);
    expect(fullPlan.find((step: Identified) => step.id === 'playwright-agent-dev')?.args)
      .toEqual(['run', 'test:e2e:agent-dev-quality:run']);

    const fastOptions = parseDeepTestArgs(['--fast-unit', '--fast-typecheck', '--smoke-e2e']);
    const fastPlan = createDeepTestPlan(fastOptions, createFreshBuildReuse());
    expect(fastPlan.find((step: Identified) => step.id === 'typecheck')?.args).toEqual(['run', 'typecheck:agent-dev']);
    expect(fastPlan.find((step: Identified) => step.id === 'vitest-agent-dev')?.args).toEqual(['agent-dev:unit:fast']);
    expect(fastPlan.find((step: Identified) => step.id === 'playwright-agent-dev')?.args)
      .toEqual(['run', 'test:e2e:agent-dev-quality:smoke']);

    const cachedOptions = parseDeepTestArgs(['--cached-typecheck']);
    const cachedPlan = createDeepTestPlan(cachedOptions, createFreshBuildReuse());
    expect(cachedPlan.find((step: Identified) => step.id === 'typecheck')?.args).toEqual(['run', 'typecheck:cached']);

    const dailyReuseOptions = parseDeepTestArgs(['--reuse-build', '--cached-typecheck', '--smoke-e2e']);
    const dailyReusePlan = createDeepTestPlan(dailyReuseOptions, {
      status: 'reused',
      reusable: true,
      reason: 'fresh enough',
    });
    expect(dailyReusePlan.find((step: Identified) => step.id === 'e2e-build')).toEqual(expect.objectContaining({
      skipped: true,
      commandLine: 'reuse existing build',
    }));
    expect(dailyReusePlan.find((step: Identified) => step.id === 'playwright-agent-dev')?.args)
      .toEqual(['run', 'test:e2e:agent-dev-quality:smoke']);
  });

  it('represents a reusable build as a skipped e2e-build step in the deep-test plan', () => {
    const plan = createDeepTestPlan(parseDeepTestArgs(['--reuse-build']), {
      status: 'reused',
      reusable: true,
      reason: 'fresh enough',
    });
    const build = plan.find((step: Identified) => step.id === 'e2e-build');

    expect(build).toEqual(expect.objectContaining({
      skipped: true,
      reuseStatus: 'reused',
      commandLine: 'reuse existing build',
    }));
  });

  it('summarizes deep-test decisions for full gates, fast paths, and blocked runs', () => {
    const baseReport = {
      success: true,
      buildReuse: { status: 'fresh' },
      unitMode: 'full',
      typecheckMode: 'full',
      e2eMode: 'full',
      results: [{ id: 'typecheck', ok: true, durationMs: 10, commandLine: 'pnpm run typecheck' }],
    };
    const okLimits = [{ id: 'typecheck', severity: 'ok' }];

    expect(summarizeDeepTestDecision(baseReport, okLimits)).toEqual(expect.objectContaining({
      status: 'daily-loop-ok',
      releaseReady: true,
      requiredFullGates: [],
    }));

    expect(summarizeDeepTestDecision({
      ...baseReport,
      buildReuse: { status: 'reused' },
      unitMode: 'fast',
      typecheckMode: 'parallel',
      e2eMode: 'smoke',
    }, okLimits)).toEqual(expect.objectContaining({
      status: 'needs-full-gate',
      dailyLoopReady: true,
      releaseReady: false,
      requiredFullGates: [
        'pnpm run build:vite',
        'pnpm agent-dev:unit',
        'pnpm run typecheck',
        'pnpm test:e2e:agent-dev-quality',
      ],
    }));

    expect(summarizeDeepTestDecision({
      ...baseReport,
      success: false,
      results: [{ id: 'typecheck', ok: false, durationMs: 10, commandLine: 'pnpm run typecheck' }],
    }, okLimits)).toEqual(expect.objectContaining({
      status: 'blocked',
      dailyLoopReady: false,
      releaseReady: false,
    }));
  });

  it('creates compact history entries and same-mode trend summaries', () => {
    const previousReport = {
      generatedAt: '2026-01-01T00:00:00.000Z',
      success: true,
      totalDurationMs: 60000,
      decision: { status: 'needs-full-gate', releaseReady: false },
      buildReuse: { status: 'reused' },
      unitMode: 'fast',
      typecheckMode: 'parallel',
      e2eMode: 'smoke',
      results: [{ id: 'e2e-build', durationMs: 1, skipped: true, ok: true }],
      performanceLimits: [{ id: 'e2e-build', severity: 'ok' }],
    };
    const currentReport = {
      ...previousReport,
      generatedAt: '2026-01-02T00:00:00.000Z',
      totalDurationMs: 45000,
    };
    const previous = createHistoryEntry(previousReport);
    const current = createHistoryEntry(currentReport);

    expect(previous).toEqual(expect.objectContaining({
      decisionStatus: 'needs-full-gate',
      modes: {
        buildReuse: 'reused',
        unit: 'fast',
        typecheck: 'parallel',
        e2e: 'smoke',
      },
    }));
    expect(summarizeTrend([previous], current)).toEqual(expect.objectContaining({
      direction: 'improved',
      sameModeDeltaMs: -15000,
      sameModeSampleCount: 2,
    }));
  });

  it('scores Agent Dev audit fixtures and flags blocked performance evidence as disqualifying', () => {
    const packageJson = {
      scripts: {
        'typecheck': 'node scripts/typecheck-agent-dev.mjs',
        'typecheck:cached': 'node scripts/typecheck-agent-dev.mjs --cache',
        'typecheck:force': 'node scripts/typecheck-agent-dev.mjs --force',
        'agent-dev:unit': 'pnpm agent-dev:unit:node && pnpm exec vitest run --maxWorkers=1 tests/unit/host-api-facade.test.ts',
        'build:vite': 'vite build',
        'test:e2e:agent-dev-quality': 'pnpm run build:vite && playwright test tests/e2e/agent-dev-quality.spec.ts --workers=2',
        'agent-dev:deep-test': 'node scripts/agent-dev-deep-test.mjs',
        'agent-dev:fast': 'pnpm contract:check && pnpm i18n:lint && pnpm agent-dev:workbench && pnpm agent-dev:unit:fast',
        'agent-dev:unit:node': 'pnpm exec vitest run --config vitest.agent-dev.node.config.ts',
        'agent-dev:unit:fast': 'pnpm agent-dev:unit',
        'typecheck:agent-dev': 'node scripts/typecheck-agent-dev.mjs',
        'test:e2e:agent-dev-quality:smoke': 'playwright test --grep Workbench',
        'agent-dev:deep-test:reuse': 'node scripts/agent-dev-deep-test.mjs --reuse-build --cached-typecheck --smoke-e2e',
        'agent-dev:deep-test:reuse:full': 'node scripts/agent-dev-deep-test.mjs --reuse-build --cached-typecheck',
        'contract:check': 'node scripts/contract-check.mjs',
        'i18n:lint': 'node scripts/i18n-lint.mjs',
      },
    };
    const registryText = `export const AGENT_DEV_SCENARIOS = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' },
      { id: 'f' }, { id: 'g' }, { id: 'h' }, { id: 'i' }, { id: 'j' },
    ] as const;`;
    const baseInputs = {
      packageJson,
      deepReport: {
        success: true,
        decision: {
          status: 'daily-loop-ok',
          releaseReady: true,
          fastPathModes: [],
          requiredFullGates: [],
        },
        results: [{ id: 'typecheck', ok: true, skipped: false }],
        performanceLimits: [{ id: 'typecheck', severity: 'ok', durationMs: 100, targetMs: 200, limitMs: 300 }],
      },
      qualityReport: { decision: { status: 'daily-loop-ok' } },
      history: { trend: {}, entries: [] },
      workbenchEvidence: { hostApi: { missingFacadeActions: [], missingServiceActions: [] } },
      registryText,
      docsText: [
        'decision.status',
        'decision.requiredFullGates',
        'pnpm agent-dev:deep-test:reuse',
        'pnpm agent-dev:unit:fast',
        'pnpm run typecheck:agent-dev',
        'pnpm run typecheck:cached',
        'pnpm agent-dev:deep-test:reuse:full',
        'pnpm run test:e2e:agent-dev-quality:smoke',
        'Release evidence',
        'shared/agent-dev/scenarios.ts',
      ].join('\n'),
      agentsText: 'decision.status',
      readmeText: 'decision',
      regularizationTestText: 'summarizes deep-test decisions\nsame-mode trend summaries',
      deepTestText: 'slice(-20)',
      workbenchText: 'shared/agent-dev/scenarios.ts',
    };

    const passing = buildAuditReport(baseInputs);
    expect(passing.status).toBe('pass');
    expect(passing.totalScore).toBeGreaterThanOrEqual(90);
    expect(passing.maturityLevel).toBe('release-grade');
    expect(passing.confidence.level).toBe('high');
    expect(passing.prioritizedFindings).toEqual([]);

    const blocked = buildAuditReport({
      ...baseInputs,
      deepReport: {
        ...baseInputs.deepReport,
        decision: {
          status: 'blocked',
          reason: 'typecheck exceeded hard performance limits.',
          fastPathModes: ['parallel-typecheck'],
          requiredFullGates: ['pnpm run typecheck'],
        },
        performanceLimits: [{ id: 'typecheck', severity: 'limit', durationMs: 40000, targetMs: 25000, limitMs: 35000 }],
      },
    });
    expect(blocked.status).toBe('fail');
    expect(blocked.maturityLevel).toBe('blocked');
    expect(blocked.prioritizedFindings[0]).toEqual(expect.objectContaining({
      priority: 'P0',
      severity: 'fail',
      impact: 'high',
      validationCommands: expect.arrayContaining(['pnpm agent-dev:audit:report']),
    }));
    expect(blocked.scoreBreakdown.find((item: Identified) => item.id === 'performance-discipline'))
      .toEqual(expect.objectContaining({
        deducted: expect.any(Number),
        status: 'fail',
      }));
    expect(blocked.disqualifiers.map((item: Identified) => item.id)).toEqual(expect.arrayContaining([
      'latest-decision-blocked',
      'performance-limit:typecheck',
    ]));

    const stale = buildAuditReport({
      ...baseInputs,
      evidenceInventory: [{
        id: 'deep-test',
        path: 'artifacts/agent-dev-deep-test/report.json',
        required: true,
        generated: true,
        exists: true,
        parseable: true,
        ageHours: 48,
        fresh: false,
      }],
    });
    expect(stale.confidence).toEqual(expect.objectContaining({
      level: 'medium',
      staleGeneratedCount: 1,
    }));
    expect(stale.dimensions.find((dimension: Identified) => dimension.id === 'evidence-completeness')?.findings)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'evidence-stale:deep-test', severity: 'fail' }),
      ]));
    // R5-2: 过期证据是 hard veto —— 必须让报告整体 fail、成熟度 blocked、进入 disqualifiers。
    expect(stale.status).toBe('fail');
    expect(stale.maturityLevel).toBe('blocked');
    expect(stale.disqualifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'evidence-stale:deep-test', severity: 'fail' }),
    ]));

    const sourceNewer = buildAuditReport({
      ...baseInputs,
      evidenceInventory: [{
        id: 'deep-test',
        path: 'artifacts/agent-dev-deep-test/report.json',
        required: true,
        generated: true,
        exists: true,
        parseable: true,
        ageHours: 1,
        fresh: false,
        sourceFresh: false,
        newestRelevantSource: { path: 'scripts/agent-dev-deep-test.mjs' },
      }],
    });
    expect(sourceNewer.dimensions.find((dimension: Identified) => dimension.id === 'evidence-completeness')?.findings)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'evidence-source-newer:deep-test', severity: 'fail' }),
      ]));
    // R5-2: 证据比 Agent Dev 源文件旧同样是 hard veto。
    expect(sourceNewer.status).toBe('fail');
    expect(sourceNewer.disqualifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'evidence-source-newer:deep-test', severity: 'fail' }),
    ]));
  });

  it('resolves agent-dev source change times through git for clean checkouts', async () => {
    const root = join(tmpdir(), `clawx-agent-dev-audit-git-${Date.now()}`);
    await mkdir(root, { recursive: true });
    const git = (...args: string[]) => execFileAsync('git', args, { cwd: root });
    await git('init', '-q');
    await git('config', 'user.email', 'audit@test.local');
    await git('config', 'user.name', 'audit');
    const file = join(root, 'source.mjs');
    await writeFile(file, 'export const a = 1;\n', 'utf8');
    // An absurd future mtime must not poison freshness once the file is
    // committed clean in git (clean checkouts share checkout-time mtimes).
    const futureMtime = new Date('2035-01-01T00:00:00Z');
    await utimes(file, futureMtime, futureMtime);
    await git('add', 'source.mjs');
    await git('commit', '-qm', 'add source');

    const rel = 'source.mjs';
    const cleanState = collectGitSourceState(root, [rel]);
    expect(cleanState).not.toBeNull();
    const clean = resolveSourceChangeTimeMs({ path: rel, mtimeMs: futureMtime.getTime() }, cleanState);
    expect(clean.timeSource).toBe('git-commit');
    expect(clean.timeMs).toBeLessThanOrEqual(Date.now());
    expect(clean.timeMs).toBeLessThan(futureMtime.getTime());

    // A dirty tracked file falls back to working-tree mtime so the daily
    // loop keeps hard-failing until evidence is refreshed.
    await writeFile(file, 'export const a = 2;\n', 'utf8');
    await utimes(file, futureMtime, futureMtime);
    const dirtyState = collectGitSourceState(root, [rel]);
    const dirty = resolveSourceChangeTimeMs({ path: rel, mtimeMs: futureMtime.getTime() }, dirtyState);
    expect(dirty.timeSource).toBe('worktree-mtime');
    expect(dirty.timeMs).toBe(futureMtime.getTime());

    // Untracked files keep working-tree mtime.
    const untracked = resolveSourceChangeTimeMs({ path: 'new-file.mjs', mtimeMs: futureMtime.getTime() }, dirtyState);
    expect(untracked.timeSource).toBe('worktree-mtime');
    expect(untracked.timeMs).toBe(futureMtime.getTime());

    // Without git state (not a repository) the previous mtime behavior holds.
    const noGit = resolveSourceChangeTimeMs({ path: rel, mtimeMs: futureMtime.getTime() }, null);
    expect(noGit.timeSource).toBe('worktree-mtime');
    expect(noGit.timeMs).toBe(futureMtime.getTime());

    await rm(root, { recursive: true, force: true });
  });

  it('parses audit CLI reporting mode and classifies maturity levels', () => {
    expect(parseAuditArgs(['--no-fail'])).toEqual({ noFail: true });
    expect(parseAuditArgs([])).toEqual({ noFail: false });
    expect(maturityLevelForScore(96, 0)).toBe('release-grade');
    expect(maturityLevelForScore(91, 0)).toBe('review-ready');
    expect(maturityLevelForScore(85, 0)).toBe('daily-loop-ready');
    expect(maturityLevelForScore(75, 0)).toBe('developing');
    expect(maturityLevelForScore(95, 1)).toBe('blocked');
  });
});
