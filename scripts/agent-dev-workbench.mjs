import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const REGISTRY_PATH = resolve(ROOT, 'shared/agent-dev/scenarios.ts');
const CONTRACT_PATH = resolve(ROOT, 'shared/host-api/contract.ts');
const HOST_API_PATH = resolve(ROOT, 'src/lib/host-api.ts');
const AGENT_DEV_SERVICE_PATH = resolve(ROOT, 'electron/services/agent-dev-api.ts');
const TRACE_CONTRACT_PATH = resolve(ROOT, 'shared/agent-dev/trace-contract.ts');
const OUT_DIR = resolve(ROOT, 'artifacts/agent-dev-workbench');
const OUT_FILE = resolve(OUT_DIR, 'index.html');
const OUT_EVIDENCE_FILE = resolve(OUT_DIR, 'evidence.json');
const PACKAGE_PATH = resolve(ROOT, 'package.json');
const DEEP_TEST_REPORT_PATH = resolve(ROOT, 'artifacts', 'agent-dev-deep-test', 'report.json');
const DEEP_TEST_HISTORY_PATH = resolve(ROOT, 'artifacts', 'agent-dev-deep-test', 'history.json');
const AUDIT_REPORT_PATH = resolve(ROOT, 'artifacts', 'agent-dev-audit', 'report.json');
const QUALITY_REPORT_PATH = resolve(ROOT, 'artifacts', 'agent-dev-quality', 'report.json');

function extractScenarios(registryText) {
  const match = registryText.match(/export const AGENT_DEV_SCENARIOS = \[([\s\S]*?)\] as const/);
  if (!match) return [];
  return [...match[1].matchAll(/\{\s*id:\s*'([^']+)'[\s\S]*?route:\s*'([^']+)'[\s\S]*?description:\s*'([^']+)'/g)]
    .map((entry) => ({
      id: entry[1],
      route: entry[2],
      description: entry[3],
    }));
}

async function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readTextIfExists(path) {
  if (!existsSync(path)) return '';
  return await readFile(path, 'utf8');
}

function extractAgentDevContractActions(contractText) {
  const match = contractText.match(/agentDev:\s*\{([\s\S]*?)^\s{2}\};/m);
  if (!match) return [];
  return [...match[1].matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)]
    .map((entry) => entry[1])
    .sort();
}

function extractAgentDevFacadeActions(hostApiText) {
  const match = hostApiText.match(/^\s{2}agentDev:\s*\{([\s\S]*?)^\s{2}\},/m);
  if (!match) return [];
  return [...match[1].matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)]
    .map((entry) => entry[1])
    .sort();
}

function extractAgentDevServiceActions(serviceText) {
  return [...serviceText.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):\s*(?:async\s*)?(?:\(|\()/gm)]
    .map((entry) => entry[1])
    .sort();
}

async function collectReportIndex() {
  const packageJson = await readJsonIfExists(PACKAGE_PATH);
  const deepTestReport = await readJsonIfExists(DEEP_TEST_REPORT_PATH);
  const deepTestHistory = await readJsonIfExists(DEEP_TEST_HISTORY_PATH);
  const auditReport = await readJsonIfExists(AUDIT_REPORT_PATH);
  const qualityReport = await readJsonIfExists(QUALITY_REPORT_PATH);
  const contractText = await readTextIfExists(CONTRACT_PATH);
  const hostApiText = await readTextIfExists(HOST_API_PATH);
  const serviceText = await readTextIfExists(AGENT_DEV_SERVICE_PATH);
  const traceContractText = await readTextIfExists(TRACE_CONTRACT_PATH);
  const contractActions = extractAgentDevContractActions(contractText);
  const facadeActions = extractAgentDevFacadeActions(hostApiText);
  const serviceActions = extractAgentDevServiceActions(serviceText);
  const artifactStatus = {
    workbench: existsSync(resolve(ROOT, 'artifacts', 'agent-dev-workbench')),
    quality: existsSync(resolve(ROOT, 'artifacts', 'agent-dev-quality')),
    channelConformance: existsSync(resolve(ROOT, 'artifacts', 'channel-conformance')),
    scenarioRecordings: existsSync(resolve(ROOT, 'artifacts', 'agent-dev-scenarios')),
  };
  return {
    scripts: packageJson?.scripts ?? {},
    hostApi: {
      contractActions,
      facadeActions,
      serviceActions,
      missingFacadeActions: contractActions.filter((action) => !facadeActions.includes(action)),
      missingServiceActions: contractActions.filter((action) => !serviceActions.includes(action)),
    },
    traceContracts: {
      traceTimeline: traceContractText.includes('AgentDevTraceEvent'),
      costReport: traceContractText.includes('AgentDevCostReport'),
      skillSandboxReport: traceContractText.includes('AgentDevSkillSandboxReport'),
    },
    artifactStatus,
    artifacts: {
      quality: artifactStatus.quality,
      channelConformance: artifactStatus.channelConformance,
      scenarioRecordings: artifactStatus.scenarioRecordings,
    },
    gateCommands: {
      fastPr: [
        'pnpm agent-dev:fast',
      ],
      fullLocal: [
        'pnpm agent-dev:full-local',
        'pnpm run test:e2e:agent-dev-quality:run',
        'pnpm channel:conformance <channel-name>',
      ],
      nightlyRelease: [
        'pnpm agent-dev:deep-test',
        'pnpm run comms:replay',
        'pnpm run comms:compare',
        'pnpm run test:e2e',
      ],
    },
    performance: {
      latest: deepTestReport
        ? {
          generatedAt: deepTestReport.generatedAt,
          success: deepTestReport.success,
          totalDurationMs: deepTestReport.totalDurationMs,
          decision: deepTestReport.decision,
          modes: {
            buildReuse: deepTestReport.buildReuse?.status,
            unit: deepTestReport.unitMode,
            typecheck: deepTestReport.typecheckMode,
            e2e: deepTestReport.e2eMode,
          },
          bottlenecks: deepTestReport.bottlenecks ?? [],
          diagnostics: deepTestReport.diagnostics ?? {},
        }
        : null,
      history: deepTestHistory
        ? {
          trend: deepTestHistory.trend,
          entries: (deepTestHistory.entries ?? []).slice(-8),
        }
        : null,
      audit: auditReport
        ? {
          status: auditReport.status,
          grade: auditReport.grade,
          totalScore: auditReport.totalScore,
          maxScore: auditReport.maxScore,
          confidence: auditReport.confidence,
          scoreBreakdown: auditReport.scoreBreakdown ?? [],
          disqualifierCount: auditReport.disqualifiers?.length ?? 0,
        }
        : null,
      quality: qualityReport
        ? {
          success: qualityReport.success,
          build: qualityReport.build,
          playwright: qualityReport.playwright,
        }
        : null,
    },
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderHtml(scenarios, reportIndex) {
  const hostApi = reportIndex.hostApi ?? {
    contractActions: [],
    facadeActions: [],
    serviceActions: [],
    missingFacadeActions: [],
    missingServiceActions: [],
  };
  const artifacts = reportIndex.artifacts ?? {};
  const scripts = reportIndex.scripts ?? {};
  const gateCommands = reportIndex.gateCommands ?? {};
  const performance = reportIndex.performance ?? {};
  const latest = performance.latest;
  const audit = performance.audit;
  const rows = scenarios.map(({ id, route, description }) => {
    const href = `${route}?e2eSkipSetup=1&devScenario=${encodeURIComponent(id)}&visual=1`;
    return `<tr><td><code>${escapeHtml(id)}</code></td><td><code>${escapeHtml(route)}</code></td><td>${escapeHtml(description)}</td><td><a href="${escapeHtml(href)}">open</a></td></tr>`;
  }).join('\n');
  const panels = [
    ['Scenario Manager', `${scenarios.length} registered scenarios from shared/agent-dev/scenarios.ts`, 'pnpm agent-dev:workbench'],
    ['Contract Viewer', `${hostApi.contractActions.length} agentDev contract actions; ${hostApi.missingFacadeActions.length} facade gaps; ${hostApi.missingServiceActions.length} service gaps`, 'pnpm contract:check'],
    ['Trace Timeline', 'hostApi.agentDev.traceTimeline exposes requestId-correlated events', 'hostApi.agentDev.traceTimeline({ requestId })'],
    ['i18n Report', scripts['i18n:lint'] ? 'i18n:lint script available' : 'i18n:lint script missing', 'pnpm i18n:lint'],
    ['Quality Report', artifacts.quality ? 'quality artifacts present' : 'quality artifacts not generated yet', 'pnpm test:e2e:agent-dev-quality'],
    ['Deep-Test Decision', latest?.decision ? `${latest.decision.status}; ${Math.round((latest.totalDurationMs ?? 0) / 1000)}s; build=${latest.modes?.buildReuse}, unit=${latest.modes?.unit}, typecheck=${latest.modes?.typecheck}, e2e=${latest.modes?.e2e}` : 'deep-test report not generated yet', 'pnpm agent-dev:deep-test'],
    ['Maturity Audit', audit ? `${audit.status}; grade ${audit.grade}; score ${audit.totalScore}/${audit.maxScore}; disqualifiers ${audit.disqualifierCount}` : 'audit report not generated yet', 'pnpm agent-dev:audit'],
    ['Skill Sandbox', 'hostApi.agentDev.skillSandboxReport exposes capability gates, budgets, and effect log', 'hostApi.agentDev.skillSandboxReport()'],
    ['Channel Conformance', scripts['channel:conformance'] ? 'channel conformance script available' : 'channel conformance script missing', 'pnpm channel:conformance <name>'],
    ['Cost Simulator', 'hostApi.agentDev.costReport estimates usage from trace metadata', 'hostApi.agentDev.costReport()'],
    ['Scenario Recorder', artifacts.scenarioRecordings ? 'redacted recordings are awaiting human review under artifacts/agent-dev-scenarios' : 'no reviewed recording artifacts generated yet', 'hostApi.agentDev.recordScenario()'],
  ].map(([title, detail, command]) => `<section><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p><code>${escapeHtml(command)}</code></section>`).join('\n');
  const actionRows = hostApi.contractActions.map((action) => {
    const facade = hostApi.facadeActions.includes(action) ? 'yes' : 'no';
    const service = hostApi.serviceActions.includes(action) ? 'yes' : 'no';
    return `<tr><td><code>${escapeHtml(action)}</code></td><td>${facade}</td><td>${service}</td></tr>`;
  }).join('\n');
  const gateRows = Object.entries(gateCommands).flatMap(([gate, commands]) => (
    Array.isArray(commands)
      ? commands.map((command) => `<tr><td><code>${escapeHtml(gate)}</code></td><td><code>${escapeHtml(command)}</code></td></tr>`)
      : []
  )).join('\n');
  const bottleneckRows = (latest?.bottlenecks ?? []).slice(0, 5).map((step) => (
    `<tr><td><code>${escapeHtml(step.id)}</code></td><td>${escapeHtml(step.durationMs)}ms</td><td><code>${escapeHtml(step.commandLine ?? '')}</code></td><td>${step.skipped ? 'yes' : 'no'}</td></tr>`
  )).join('\n') || '<tr><td colspan="4">No deep-test bottleneck report available.</td></tr>';
  const historyRows = (performance.history?.entries ?? []).slice(-8).reverse().map((entry) => (
    `<tr><td>${escapeHtml(entry.generatedAt)}</td><td>${escapeHtml(entry.decisionStatus)}</td><td>${escapeHtml(entry.totalDurationMs)}ms</td><td><code>${escapeHtml(Object.values(entry.modes ?? {}).join(' / '))}</code></td></tr>`
  )).join('\n') || '<tr><td colspan="4">No deep-test history available.</td></tr>';
  const scoreRows = (audit?.scoreBreakdown ?? []).map((entry) => (
    `<tr><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(entry.title)}</td><td>${escapeHtml(entry.score)}/${escapeHtml(entry.maxScore)}</td><td>${escapeHtml(entry.deducted)}</td></tr>`
  )).join('\n') || '<tr><td colspan="4">No audit score breakdown available.</td></tr>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent Dev Workbench</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #111827; }
    h1 { font-size: 24px; font-weight: 500; margin: 0 0 16px; }
    h2 { font-size: 15px; margin: 0 0 8px; }
    p { max-width: 760px; color: #4b5563; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 24px; }
    section { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; }
    section p { margin: 0 0 10px; }
    table { border-collapse: collapse; width: 100%; margin-top: 24px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 10px 12px; text-align: left; }
    th { color: #374151; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    code { background: #f3f4f6; border-radius: 4px; padding: 2px 5px; }
    a { color: #2563eb; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Agent Dev Workbench</h1>
  <p>This generated control plane lists typed <code>devScenario</code> entry points and the local validation/report surfaces that back Agent Dev regularization.</p>
  <div class="grid">${panels}</div>
  <h2>Agent Dev Host API Evidence</h2>
  <table>
    <thead><tr><th>Action</th><th>Renderer facade</th><th>Main service</th></tr></thead>
    <tbody>${actionRows}</tbody>
  </table>
  <h2>Gate Commands</h2>
  <table>
    <thead><tr><th>Gate</th><th>Command</th></tr></thead>
    <tbody>${gateRows}</tbody>
  </table>
  <h2>Latest Deep-Test Bottlenecks</h2>
  <table>
    <thead><tr><th>Step</th><th>Duration</th><th>Command</th><th>Skipped</th></tr></thead>
    <tbody>${bottleneckRows}</tbody>
  </table>
  <h2>Deep-Test History</h2>
  <table>
    <thead><tr><th>Generated</th><th>Decision</th><th>Total</th><th>Modes</th></tr></thead>
    <tbody>${historyRows}</tbody>
  </table>
  <h2>Audit Score Breakdown</h2>
  <table>
    <thead><tr><th>Status</th><th>Dimension</th><th>Score</th><th>Deducted</th></tr></thead>
    <tbody>${scoreRows}</tbody>
  </table>
  <p>Workbench remains a generated static artifact in this phase. If it moves into the app, it must enter through <code>src/lib/host-api.ts</code>/<code>src/lib/host-api-client.ts</code> and four-locale i18n.</p>
  <h2>Scenario Registry</h2>
  <table>
    <thead><tr><th>Scenario</th><th>Route</th><th>Description</th><th>Link</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

async function main() {
  const registry = await readFile(REGISTRY_PATH, 'utf8');
  const scenarios = extractScenarios(registry);
  if (scenarios.length === 0) {
    throw new Error('No agent dev scenario registry entries found.');
  }
  await mkdir(OUT_DIR, { recursive: true });
  const reportIndex = await collectReportIndex();
  await writeFile(OUT_FILE, renderHtml(scenarios, reportIndex), 'utf8');
  const evidence = {
    schema: 'clawx.agent-dev.workbench-evidence.v1',
    generatedAt: new Date().toISOString(),
    scenarioCount: scenarios.length,
    scenarios,
    ...reportIndex,
  };
  await writeFile(OUT_EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    success: true,
    scenarioCount: scenarios.length,
    reports: reportIndex.artifacts,
    output: OUT_FILE,
    evidence: OUT_EVIDENCE_FILE,
  }, null, 2));
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { escapeHtml, extractScenarios, renderHtml, main };
