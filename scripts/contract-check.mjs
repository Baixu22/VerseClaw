#!/usr/bin/env node

import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = process.cwd();
const REQUIRED_AGENT_DEV_SCENARIOS = [
  'chat-empty',
  'chat-streaming',
  'models-heavy-usage',
  'settings-provider-error',
  'doctor-failed',
  'gateway-connecting',
  'knowledge-drafts',
  'observability-trace-errors',
  'transport-fallback-chain',
  'skill-execution-timeout',
  'multi-agent-handoff',
  'knowledge-conflict-merge',
  'channel-reconnect-storm',
  'clawgraph-dag-cycle',
];

async function readProjectFile(path) {
  const [{ readFile }, { resolve }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ]);
  return await readFile(resolve(ROOT, path), 'utf8');
}

function parseContractActions(contractText) {
  const start = contractText.indexOf('export type HostApiContract = {');
  if (start === -1) return new Map();
  const block = extractObjectBlock(contractText, contractText.indexOf('{', start));
  const modules = new Map();
  const moduleMatches = block.matchAll(/^  ([A-Za-z][A-Za-z0-9]*): \{\r?\n([\s\S]*?)^  \};\r?$/gm);
  for (const match of moduleMatches) {
    const moduleName = match[1];
    const actions = [...match[2].matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)].map((entry) => entry[1]);
    modules.set(moduleName, new Set(actions));
  }
  return modules;
}

function parseFacadeActions(hostApiText) {
  const start = hostApiText.indexOf('export const hostApi = {');
  if (start === -1) return new Map();
  const block = extractObjectBlock(hostApiText, hostApiText.indexOf('{', start));
  const modules = new Map();
  const moduleMatches = block.matchAll(/^  ([A-Za-z][A-Za-z0-9]*): \{\r?\n([\s\S]*?)^  \},?\r?$/gm);
  for (const match of moduleMatches) {
    const moduleName = match[1];
    const moduleBlock = match[2];
    const actionMatches = [...moduleBlock.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)];
    modules.set(moduleName, new Set(actionMatches.map((entry) => entry[1])));
  }
  return modules;
}


function extractExportedObjectBody(moduleText, identifier) {
  const exportRegex = new RegExp('export const ' + identifier + ' = \\{');
  const match = moduleText.match(exportRegex);
  if (!match || match.index === undefined) return '';
  const openIndex = moduleText.indexOf('{', match.index);
  return extractObjectBlock(moduleText, openIndex);
}

function resolveModuleFacadeBody(body, moduleFacadeTexts) {
  let resolved = body;
  for (;;) {
    const spread = resolved.match(/^(\s*)\.\.\.([A-Za-z][A-Za-z0-9]*),?$/m);
    if (!spread) break;
    const identifier = spread[2];
    const moduleText = moduleFacadeTexts[identifier];
    const moduleBody = moduleText
      ? extractExportedObjectBody(moduleText, identifier)
      : '';
    resolved = moduleBody
      ? resolved.replace(spread[0], moduleBody)
      : resolved.replace(spread[0], '');
  }
  return resolved;
}

function inlineModuleFacadeAliases(hostApiText, moduleFacadeTexts) {
  let inlined = hostApiText;
  for (const [identifier, moduleText] of Object.entries(moduleFacadeTexts)) {
    const aliasRegex = new RegExp('^  ([A-Za-z][A-Za-z0-9]*): ' + identifier + ',?$', 'm');
    const alias = inlined.match(aliasRegex);
    if (!alias) continue;
    const body = extractExportedObjectBody(moduleText, identifier);
    if (!body) continue;
    const resolved = resolveModuleFacadeBody(body, moduleFacadeTexts);
    const indented = resolved
      .split('\n')
      .map((line) => (line ? '  ' + line : line))
      .join('\n');
    const replacement = '  ' + alias[1] + ': {' + indented + '\n  },';
    inlined = inlined.replace(alias[0], () => replacement);
  }
  return inlined;
}

function parseRegisteredModules(ipcHandlersText) {
  const match = ipcHandlersText.match(/const services: HostServiceRegistry = \{([\s\S]*?)\n\s{2}\};/)
    ?? ipcHandlersText.match(/hostApiRegistry\.registerCoreServices\(\{([\s\S]*?)\n\s{2}\}\);/);
  const modules = new Set(match ? [...match[1].matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)].map((entry) => entry[1]) : []);
  for (const entry of ipcHandlersText.matchAll(/module:\s*'([^']+)'/g)) {
    modules.add(entry[1]);
  }
  return modules;
}

function parseRegistryScenarioIds(registryText) {
  const match = registryText.match(/export const AGENT_DEV_SCENARIOS = \[([\s\S]*?)\] as const/);
  return match ? [...match[1].matchAll(/\{\s*id:\s*'([^']+)'/g)].map((entry) => entry[1]) : [];
}

function hasInvokeHostForAction(hostApiText, moduleName, actionName) {
  const actionBody = extractFacadeActionBody(hostApiText, moduleName, actionName);
  return actionBody.includes(`invokeHost('${moduleName}', '${actionName}'`);
}

function extractObjectBlock(text, openIndex) {
  if (openIndex < 0 || text[openIndex] !== '{') return '';
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, index);
    }
  }
  return text.slice(openIndex + 1);
}

function extractFacadeActionBody(hostApiText, moduleName, actionName) {
  const moduleStart = hostApiText.search(new RegExp(`^  ${moduleName}: \\{`, 'm'));
  if (moduleStart === -1) return '';
  const moduleOpen = hostApiText.indexOf('{', moduleStart);
  const moduleBlock = extractObjectBlock(hostApiText, moduleOpen);
  const actionStart = moduleBlock.search(new RegExp(`^    ${actionName}:`, 'm'));
  if (actionStart === -1) return '';
  const nextAction = moduleBlock.slice(actionStart + 1).search(/^    [A-Za-z][A-Za-z0-9]*:/m);
  return nextAction === -1
    ? moduleBlock.slice(actionStart)
    : moduleBlock.slice(actionStart, actionStart + 1 + nextAction);
}

function collectContractIssues({
  contractText,
  hostApiText,
  ipcHandlersText,
  agentDevApiText,
  agentDevSchemaText,
  rendererAgentDevText,
  workbenchText,
  scenarioRegistryText,
}) {
  const issues = [];
  const contract = parseContractActions(contractText);
  const facade = parseFacadeActions(hostApiText);
  const registeredModules = parseRegisteredModules(ipcHandlersText);

  for (const [moduleName, actions] of contract) {
    if (!registeredModules.has(moduleName)) {
      issues.push(`electron/main/ipc-handlers.ts: missing service registry module '${moduleName}'`);
    }
    if (!facade.has(moduleName)) {
      issues.push(`src/lib/host-api.ts: missing hostApi facade module '${moduleName}'`);
      continue;
    }
    const facadeActions = facade.get(moduleName);
    for (const actionName of actions) {
      if (!facadeActions.has(actionName)) {
        issues.push(`src/lib/host-api.ts: missing hostApi.${moduleName}.${actionName} facade`);
      } else if (!hasInvokeHostForAction(hostApiText, moduleName, actionName)) {
        issues.push(`src/lib/host-api.ts: hostApi.${moduleName}.${actionName} does not call invokeHost('${moduleName}', '${actionName}')`);
      }
    }
  }

  const contractAgentDev = contract.get('agentDev') ?? new Set();
  const serviceAgentDev = new Set([...agentDevApiText.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):\s*(?:async\s*)?(?:\(|\()/gm)].map((entry) => entry[1]));
  for (const actionName of contractAgentDev) {
    if (!serviceAgentDev.has(actionName)) {
      issues.push(`electron/services/agent-dev-api.ts: missing agentDev.${actionName} service action`);
    }
  }

  const scenarioIds = parseRegistryScenarioIds(scenarioRegistryText);
  for (const id of REQUIRED_AGENT_DEV_SCENARIOS) {
    if (!scenarioIds.includes(id)) {
      issues.push(`shared/agent-dev/scenarios.ts: missing required scenario '${id}'`);
    }
  }
  if (!agentDevApiText.includes('@shared/agent-dev/scenarios')) {
    issues.push('electron/services/agent-dev-api.ts: agentDev scenarios must come from shared/agent-dev/scenarios.ts');
  }
  if (!rendererAgentDevText.includes('@shared/agent-dev/scenario-composer')) {
    issues.push('src/lib/agent-dev.ts: devScenario parsing must use shared/agent-dev/scenario-composer.ts');
  }
  if (!workbenchText.includes('shared/agent-dev/scenarios.ts')) {
    issues.push('scripts/agent-dev-workbench.mjs: workbench must read shared/agent-dev/scenarios.ts');
  }
  if (/export type AgentDevScenarioId =\s*\|/.test(contractText)) {
    issues.push('shared/host-api/contract.ts: AgentDevScenarioId must be imported from shared/agent-dev/scenarios.ts');
  }

  for (const assertion of [
    'assertAgentDevSeedStatePayload(payload)',
    'assertAgentDevMockReplayConfig(payload)',
    'assertAgentDevFeatureFlagsPayload(payload)',
    'assertAgentDevRecordScenarioPayload(payload)',
  ]) {
    if (!agentDevApiText.includes(assertion)) {
      issues.push(`electron/services/agent-dev-api.ts: missing runtime validation call ${assertion}`);
    }
  }
  if (!agentDevSchemaText.includes('AGENT_DEV_SCENARIO_IDS')) {
    issues.push('shared/host-api/agent-dev-schemas.ts: scenario schema must be derived from AGENT_DEV_SCENARIO_IDS');
  }

  return issues;
}

export {
  collectContractIssues,
  inlineModuleFacadeAliases,
  parseContractActions,
  parseFacadeActions,
  parseRegisteredModules,
  parseRegistryScenarioIds,
};

async function main() {
  const files = {
    contractText: await readProjectFile('shared/host-api/contract.ts'),
    hostApiText: inlineModuleFacadeAliases(
      await readProjectFile('src/lib/host-api.ts'),
      {
        knowledgeHostApi: await readProjectFile('src/lib/host-api/knowledge/index.ts'),
        knowledgeLibraryApi: await readProjectFile('src/lib/host-api/knowledge/library.ts'),
        knowledgeRoutingApi: await readProjectFile('src/lib/host-api/knowledge/routing.ts'),
        knowledgeInboxApi: await readProjectFile('src/lib/host-api/knowledge/inbox.ts'),
        knowledgeDraftsApi: await readProjectFile('src/lib/host-api/knowledge/drafts.ts'),
        knowledgeProposalsApi: await readProjectFile('src/lib/host-api/knowledge/proposals.ts'),
        knowledgeStewardApi: await readProjectFile('src/lib/host-api/knowledge/steward.ts'),
        knowledgeRuntimeLessonsApi: await readProjectFile('src/lib/host-api/knowledge/runtime-lessons.ts'),
        knowledgeSourceSetApi: await readProjectFile('src/lib/host-api/knowledge/source-set.ts'),
        knowledgeProvenanceApi: await readProjectFile('src/lib/host-api/knowledge/provenance.ts'),
        knowledgeWatchedDirectoriesApi: await readProjectFile('src/lib/host-api/knowledge/watched-directories.ts'),
      },
    ),
    ipcHandlersText: [
      await readProjectFile('electron/main/ipc-handlers.ts'),
      await readProjectFile('electron/extensions/builtin/diagnostics.ts'),
    ].join('\n'),
    agentDevApiText: await readProjectFile('electron/services/agent-dev-api.ts'),
    agentDevSchemaText: await readProjectFile('shared/host-api/agent-dev-schemas.ts'),
    rendererAgentDevText: await readProjectFile('src/lib/agent-dev.ts'),
    workbenchText: await readProjectFile('scripts/agent-dev-workbench.mjs'),
    scenarioRegistryText: await readProjectFile('shared/agent-dev/scenarios.ts'),
  };
  const issues = collectContractIssues(files);
  if (issues.length > 0) {
    console.error('Contract check failed:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log('Contract check passed.');
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
