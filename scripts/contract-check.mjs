#!/usr/bin/env node

import { isMainEntrypoint } from './lib/entrypoint.mjs';
import ts from 'typescript';

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

const CONTRACT_PATH = 'shared/host-api/contract.ts';
const FLAT_IPC_REGISTRY_PATH = 'scripts/contract-check-flat-ipc.json';
const FLAT_IPC_REGISTRY_SCHEMA = 'ContractCheckFlatIpcAdjudication/v1';
const FLAT_IPC_DISPOSITIONS = new Set(['retire', 'migrate', 'freeze', 'retired']);
const FLAT_IPC_PRELOAD_STATES = new Set(['allowlisted', 'unreachable']);
const IPC_MAIN_SCAN_ROOT = 'electron';

// Fixture mutations are applied to file text after it is read, so a negative
// case runs through exactly the same entry point and rules as the real gate.
const fileMutations = new Map();
// Files whose fixture mutations were actually read by the gate. A fixture that
// only mutates files the gate never reads would otherwise print a valid pass.
const consumedMutationFiles = new Set();
// One fixture batch evaluates an immutable source snapshot. Ordinary gate runs
// read the repository directly; mutations and consumed paths reset per case.
let projectSnapshot = null;
let ipcSourceSnapshot = null;
let ipcParseCache = null;

async function readProjectFile(path) {
  const [{ readFile }, { resolve }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ]);
  let text;
  try {
    if (projectSnapshot?.has(path)) text = projectSnapshot.get(path);
    else {
      text = await readFile(resolve(ROOT, path), 'utf8');
      projectSnapshot?.set(path, text);
    }
  } catch (error) {
    if (error.code !== 'ENOENT' || !fileMutations.get(path)?.some((mutation) => typeof mutation.create === 'string')) throw error;
    text = '';
  }
  return applyFileMutations(path, text);
}

function applyFileMutations(path, text) {
  const mutations = fileMutations.get(path);
  if (!mutations) return text;
  consumedMutationFiles.add(path);
  // Fixtures are written with \n; checkouts may be CRLF, so match on the
  // file's own line ending rather than the fixture author's.
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const normalize = (value) => value.replace(/\r?\n/g, eol);
  let mutated = text;
  for (const mutation of mutations) {
    // A virtual production file lets extension fixtures exercise enumeration
    // without adding source files to the candidate on disk.
    if (typeof mutation.create === 'string') {
      if (mutated) throw new Error(`fixture create target already exists: ${path}`);
      mutated = normalize(mutation.create);
    }
    if (typeof mutation.find === 'string') {
      const find = normalize(mutation.find);
      if (!mutated.includes(find)) {
        throw new Error(`fixture mutation target not found in ${path}: ${JSON.stringify(mutation.find)}`);
      }
      mutated = mutated.replace(find, () => normalize(mutation.replace ?? ''));
    }
    if (typeof mutation.append === 'string') mutated += normalize(mutation.append);
    if (typeof mutation.prepend === 'string') mutated = normalize(mutation.prepend) + mutated;
  }
  return mutated;
}

function parseContractActions(contractText, aliasTypeTexts = {}) {
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
  const aliasTexts = [contractText, ...Object.values(aliasTypeTexts)];
  for (const [memberName, typeName] of parseContractAliasMembers(contractText)) {
    const actions = parseTypeAliasActions(typeName, aliasTexts);
    if (actions) modules.set(memberName, actions);
  }
  return modules;
}

// `member: SomeTypeName;` inside HostApiContract. The inline-block regex above
// never sees these, which is how changeContext escaped reconciliation.
function parseContractAliasMembers(contractText) {
  const start = contractText.indexOf('export type HostApiContract = {');
  if (start === -1) return new Map();
  const block = extractObjectBlock(contractText, contractText.indexOf('{', start));
  const aliases = new Map();
  for (const match of block.matchAll(/^  ([A-Za-z][A-Za-z0-9]*): ([A-Za-z][A-Za-z0-9]*);\r?$/gm)) {
    aliases.set(match[1], match[2]);
  }
  return aliases;
}

function parseTypeAliasActions(typeName, texts) {
  for (const text of texts) {
    const match = text.match(new RegExp('export type ' + typeName + ' = \\{'));
    if (!match || match.index === undefined) continue;
    const body = extractObjectBlock(text, text.indexOf('{', match.index));
    return new Set([...body.matchAll(/^  ([A-Za-z][A-Za-z0-9]*):/gm)].map((entry) => entry[1]));
  }
  return null;
}

// Relative `import type { X } from './y'` specifiers in contract.ts, so alias
// member types can be read from their defining module without a hand-kept map.
function parseContractTypeImports(contractText) {
  const imports = new Map();
  for (const match of contractText.matchAll(/import (?:type )?\{([^}]*)\} from '([^']+)';/g)) {
    const specifier = match[2];
    if (!specifier.startsWith('.')) continue;
    for (const rawName of match[1].split(',')) {
      const name = rawName.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop();
      if (name) imports.set(name, specifier);
    }
  }
  return imports;
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

// Syntax owns call shape; local symbols distinguish Electron aliases from
// unrelated or shadowed objects. No project typecheck or module loading occurs.
function parseIpcCalls(text, file, ipcName, methods) {
  // A decoded IPC root must either occur literally or contain an escape.
  // Any escape forces AST parsing; a context-free lexer cannot safely skip
  // template/regexp contents and would hide subsequent registrations.
  if (!text.includes(ipcName) && !text.includes('\\')) return [];
  const cacheKey = ipcParseCache && `${ipcName}\0${file}\0${text}`;
  if (ipcParseCache?.has(cacheKey)) return ipcParseCache.get(cacheKey);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) {
    const diagnostic = source.parseDiagnostics[0];
    const line = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    throw new Error(`${file}:${line}: [flat-ipc/source-parse] ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }
  let checker;
  function declarations(node) {
    if (!checker) {
      const options = { allowJs: true, noLib: true, noResolve: true };
      const host = ts.createCompilerHost(options);
      host.getSourceFile = (name) => name === file ? source : undefined;
      checker = ts.createProgram([file], options, host).getTypeChecker();
    }
    return checker.getSymbolAtLocation(node)?.declarations ?? [];
  }
  function unwrap(node) {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
    return node;
  }
  function staticString(node) {
    node = unwrap(node);
    if (!node) return null;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) {
      const declaration = declarations(node).find((entry) => ts.isVariableDeclaration(entry)
        && (entry.parent.flags & ts.NodeFlags.Const) && entry.initializer && ts.isStringLiteralLike(unwrap(entry.initializer)));
      if (declaration) return unwrap(declaration.initializer).text;
    }
    return null;
  }
  function member(node) {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) return staticString(node.argumentExpression);
    return null;
  }
  function bindingSources(entry) {
    if (!ts.isObjectBindingPattern(entry.parent) || entry.dotDotDotToken) return [];
    const owner = entry.parent.parent;
    const sources = ts.isBindingElement(owner) ? bindingSources(owner) : owner.initializer ? [owner.initializer] : [];
    const name = entry.propertyName ?? entry.name;
    const key = ts.isComputedPropertyName(name) ? name.expression
      : ts.isIdentifier(name) ? ts.factory.createStringLiteral(name.text) : name;
    // Keep original expressions for symbol resolution and binding defaults.
    // Nested patterns select from their parent's value, not its initializer.
    return [
      ...sources.map((value) => ts.factory.createElementAccessExpression(value, key)),
      ...(entry.initializer ? [entry.initializer] : []),
    ];
  }
  function electronImport(node) {
    while (node && !ts.isImportDeclaration(node)) node = node.parent;
    return node && staticString(node.moduleSpecifier) === 'electron';
  }
  function isElectron(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
      && !declarations(node.expression).length && staticString(node.arguments[0]) === 'electron') return true;
    if (!ts.isIdentifier(node)) return false;
    return declarations(node).some((entry) =>
      ((ts.isNamespaceImport(entry) || ts.isImportClause(entry)) && electronImport(entry))
      || (ts.isImportSpecifier(entry) && (entry.propertyName ?? entry.name).text === 'default' && electronImport(entry))
      || (ts.isImportEqualsDeclaration(entry) && ts.isExternalModuleReference(entry.moduleReference)
        && staticString(entry.moduleReference.expression) === 'electron')
      || (ts.isVariableDeclaration(entry) && isElectron(entry.initializer, seen))
      || (ts.isBindingElement(entry) && bindingSources(entry).some((value) => isElectron(value, seen))));
  }
  function isIpc(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      && member(node) === ipcName && isElectron(node.expression)) return true;
    if (!ts.isIdentifier(node)) return false;
    const entries = declarations(node);
    if (!entries.length) return node.text === ipcName;
    return entries.some((entry) =>
      (ts.isImportSpecifier(entry) && (entry.propertyName ?? entry.name).text === ipcName && electronImport(entry))
      || (ts.isVariableDeclaration(entry) && isIpc(entry.initializer, seen))
      || (ts.isBindingElement(entry) && bindingSources(entry).some((value) => isIpc(value, seen))));
  }
  function ipcMethod(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return null;
    seen.add(node);
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = member(node);
      if (name === 'call' || name === 'apply') return ipcMethod(node.expression, seen);
      if ((name === null || methods.includes(name)) && isIpc(node.expression)) return { name: name ?? '<unresolved>' };
    }
    if (ts.isCallExpression(node) && member(unwrap(node.expression)) === 'bind') {
      const method = ipcMethod(unwrap(node.expression).expression, seen);
      if (method) {
        // The first bound channel wins across aliases and successive binds.
        // A spread supplying thisArg can also supply an unknown channel.
        const boundChannel = node.arguments[0] && ts.isSpreadElement(node.arguments[0])
          ? node.arguments[0] : node.arguments[1];
        return { ...method, boundChannel: method.boundChannel ?? boundChannel };
      }
    }
    if (!ts.isIdentifier(node)) return null;
    for (const entry of declarations(node)) {
      if (ts.isVariableDeclaration(entry)) {
        const method = ipcMethod(entry.initializer, seen);
        if (method) return method;
      } else if (ts.isBindingElement(entry)) {
        for (const value of bindingSources(entry)) {
          const method = ipcMethod(value, seen);
          if (method) return method;
        }
      }
    }
    return null;
  }
  const sites = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const method = ipcMethod(node.expression);
      if (method) {
        const invocation = member(unwrap(node.expression));
        let rawArgument = node.arguments[0];
        if (invocation === 'call') rawArgument = node.arguments[1];
        if (invocation === 'apply') {
          const argumentsArray = unwrap(node.arguments[1]);
          rawArgument = argumentsArray && ts.isArrayLiteralExpression(argumentsArray) ? argumentsArray.elements[0] : undefined;
        }
        rawArgument = method.boundChannel ?? rawArgument;
        const argument = unwrap(rawArgument);
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        sites.push({ file, line, channel: argument && ts.isStringLiteralLike(argument) ? argument.text : null,
          expression: rawArgument?.getText(source) ?? node.arguments[1]?.getText(source) ?? '<missing>',
          ...(method.name === '<unresolved>' ? { unresolvedMethod: node.expression.getText(source) } : {}),
          ...(method.name === 'handleOnce' ? { method: method.name } : {}) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  ipcParseCache?.set(cacheKey, sites);
  return sites;
}

function parseIpcMainHandleSites(text, file) {
  return parseIpcCalls(text, file, 'ipcMain', ['handle', 'handleOnce']);
}

function parsePreloadAllowlist(preloadText) {
  const start = preloadText.indexOf('const validChannels = [');
  if (start === -1) return null;
  const end = preloadText.indexOf('];', start);
  if (end === -1) return null;
  return [...preloadText.slice(start, end).matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

// A direct `ipcRenderer.invoke('<literal>', …)` wrapper in the preload reaches a
// channel without consulting validChannels, so the allowlist only describes
// renderer reachability if every such literal is also allowlisted.
function parsePreloadDirectInvokes(preloadText) {
  return parseIpcCalls(preloadText, 'electron/preload/index.ts', 'ipcRenderer', ['invoke']);
}

function resolveTypedDomain(prefix, contract) {
  if (contract.has(prefix)) return prefix;
  if (contract.has(prefix + 's')) return prefix + 's';
  return null;
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

function collectFlatIpcIssues({ contract, flatIpcRegistry, ipcMainHandleSites, preloadText }) {
  const issues = [];
  const tag = (rule) => `[flat-ipc/${rule}]`;
  if (!flatIpcRegistry || typeof flatIpcRegistry !== 'object') {
    issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('registry-missing')} flat IPC adjudication registry was not loaded`);
    return issues;
  }
  if (flatIpcRegistry.schema !== FLAT_IPC_REGISTRY_SCHEMA) {
    issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('registry-schema')} expected schema '${FLAT_IPC_REGISTRY_SCHEMA}' (got ${JSON.stringify(flatIpcRegistry.schema)})`);
    return issues;
  }
  const handlersFile = flatIpcRegistry.handlersFile;
  const allowlistFile = flatIpcRegistry.allowlistFile;
  const hostInvoke = flatIpcRegistry.hostInvoke ?? {};
  if (!Array.isArray(ipcMainHandleSites)) {
    issues.push(`${IPC_MAIN_SCAN_ROOT}/: ${tag('sites-missing')} ipcMain.handle sites were not enumerated`);
    return issues;
  }

  const typedSites = ipcMainHandleSites.filter((site) => site.file === hostInvoke.file && site.channel === hostInvoke.channel && site.method !== 'handleOnce');
  if (!typedSites.length) {
    issues.push(`${hostInvoke.file}: ${tag('typed-entry-missing')} expected the single typed entry ipcMain.handle('${hostInvoke.channel}')`);
  } else if (typedSites.length > 1) {
    issues.push(`${hostInvoke.file}:${typedSites[1].line}: ${tag('typed-entry-duplicate')} '${hostInvoke.channel}' must have exactly one persistent handler`);
  }
  for (const site of ipcMainHandleSites) {
    if (site.unresolvedMethod) {
      issues.push(`${site.file}:${site.line}: ${tag('non-static-method')} IPC method must be statically enumerable (got ${site.unresolvedMethod})`);
      continue;
    }
    if (site.channel === null) {
      issues.push(`${site.file}:${site.line}: ${tag('non-literal-channel')} ipcMain.handle channel must be a string literal so it can be enumerated (got ${site.expression})`);
      continue;
    }
    if (site.file === hostInvoke.file && site.channel === hostInvoke.channel && site.method !== 'handleOnce') continue;
    if (site.file !== handlersFile) {
      issues.push(`${site.file}:${site.line}: ${tag('bypass-registry')} ipcMain.${site.method ?? 'handle'}('${site.channel}') is registered outside ${handlersFile} and bypasses HostApiRegistry`);
    }
  }

  const registryByChannel = new Map();
  for (const entry of flatIpcRegistry.channels ?? []) {
    const channel = String(entry.channel ?? '');
    if (registryByChannel.has(channel)) {
      issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('duplicate-registry-entry')} '${channel}' is adjudicated more than once`);
      continue;
    }
    registryByChannel.set(channel, entry);
    if (!FLAT_IPC_DISPOSITIONS.has(entry.disposition)) {
      issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('invalid-disposition')} '${channel}' disposition must be retire|migrate|freeze|retired (got ${JSON.stringify(entry.disposition)})`);
    }
    if (!FLAT_IPC_PRELOAD_STATES.has(entry.preload)) {
      issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('invalid-preload-state')} '${channel}' preload must be allowlisted|unreachable (got ${JSON.stringify(entry.preload)})`);
    }
    const prefix = channel.split(':')[0];
    const domain = resolveTypedDomain(prefix, contract);
    if (!domain) {
      issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('no-typed-domain')} '${channel}' prefix '${prefix}' has no typed Host API module (exact or plural); a flat channel may only exist inside a typed domain`);
    } else {
      if (entry.typedModule !== domain) {
        issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('dual-entry-unacknowledged')} '${channel}' shares domain '${domain}' with the typed Host API but the registry declares typedModule ${JSON.stringify(entry.typedModule)}`);
      }
      if (!(typeof entry.reason === 'string' && entry.reason.trim())) {
        issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('dual-entry-unacknowledged')} '${channel}' shares domain '${domain}' with the typed Host API but has no reason for the compatibility exception`);
      }
      if (entry.typedAction != null && !contract.get(domain).has(entry.typedAction)) {
        issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('typed-action-missing')} '${channel}' maps to ${domain}.${entry.typedAction}, which is not declared in HostApiContract`);
      }
    }
    if ((entry.disposition === 'migrate' || entry.disposition === 'freeze')
      && !(typeof entry.removalPlan === 'string' && entry.removalPlan.trim())) {
      issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('removal-plan-missing')} '${channel}' is ${entry.disposition} but declares no removalPlan`);
    }
    if (entry.disposition === 'retired'
      && !(typeof entry.retirement?.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(entry.retirement.commit))) {
      issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('retirement-provenance-missing')} '${channel}' is retired but declares no retirement.commit`);
    }
  }

  const handlerSites = ipcMainHandleSites.filter((site) => site.file === handlersFile && site.channel !== null);
  const handlerChannels = new Set(handlerSites.map((site) => site.channel));
  for (const site of handlerSites) {
    const entry = registryByChannel.get(site.channel);
    if (!entry) {
      issues.push(`${site.file}:${site.line}: ${tag('unregistered-channel')} ipcMain.${site.method ?? 'handle'}('${site.channel}') is not adjudicated in ${FLAT_IPC_REGISTRY_PATH}`);
    } else if (entry.disposition === 'retired') {
      issues.push(`${site.file}:${site.line}: ${tag('retired-channel-live')} ipcMain.${site.method ?? 'handle'}('${site.channel}') is registered but the registry marks it retired`);
    }
  }
  for (const [channel, entry] of registryByChannel) {
    if (entry.disposition !== 'retired' && !handlerChannels.has(channel)) {
      issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('stale-registry-entry')} '${channel}' is adjudicated but has no ipcMain.handle in ${handlersFile}`);
    }
  }

  const allowlist = parsePreloadAllowlist(typeof preloadText === 'string' ? preloadText : '');
  const danglingEntries = flatIpcRegistry.danglingAllowlistEntries ?? [];
  const hasActiveRegistryEntry = [...registryByChannel.values()].some((entry) => entry.disposition !== 'retired');
  if (!allowlist && (hasActiveRegistryEntry || danglingEntries.length > 0)) {
    issues.push(`${allowlistFile}: ${tag('allowlist-missing')} could not locate the validChannels allowlist`);
    return issues;
  }
  const allowSet = new Set(allowlist ?? []);
  if (allowlist && allowSet.size !== allowlist.length) {
    issues.push(`${allowlistFile}: ${tag('allowlist-duplicate')} validChannels contains duplicate entries`);
  }
  for (const { channel, line, expression, unresolvedMethod } of parsePreloadDirectInvokes(typeof preloadText === 'string' ? preloadText : '')) {
    if (unresolvedMethod || channel === null) {
      issues.push(`${allowlistFile}:${line}: ${tag('preload-direct-invoke')} non-static invocation ${unresolvedMethod ?? expression}; only '${hostInvoke.channel}' may use ipcRenderer.invoke`);
      continue;
    }
    if (channel === hostInvoke.channel) continue;
    issues.push(`${allowlistFile}:${line}: ${tag('preload-direct-invoke')} '${channel}' is invoked directly by the preload; only '${hostInvoke.channel}' may use ipcRenderer.invoke`);
  }
  for (const [channel, entry] of registryByChannel) {
    if (entry.disposition === 'retired') continue;
    const actual = allowSet.has(channel) ? 'allowlisted' : 'unreachable';
    if (FLAT_IPC_PRELOAD_STATES.has(entry.preload) && entry.preload !== actual) {
      issues.push(`${allowlistFile}: ${tag('preload-mismatch')} '${channel}' is ${actual} in validChannels but the registry declares ${entry.preload}`);
    }
  }
  const dangling = new Map();
  for (const entry of danglingEntries) {
    const channel = String(entry.channel ?? '');
    dangling.set(channel, entry);
    if (!FLAT_IPC_DISPOSITIONS.has(entry.disposition) || !(typeof entry.reason === 'string' && entry.reason.trim())) {
      issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('dangling-unacknowledged')} dangling entry '${channel}' needs a valid disposition and a reason`);
    }
  }
  for (const channel of allowSet) {
    if (handlerChannels.has(channel)) continue;
    if (!dangling.has(channel)) {
      issues.push(`${allowlistFile}: ${tag('allowlist-dangling')} '${channel}' is in validChannels but has no ipcMain.handle and is not adjudicated as dangling in ${FLAT_IPC_REGISTRY_PATH}`);
    }
  }
  for (const channel of dangling.keys()) {
    if (!allowSet.has(channel)) {
      issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('stale-dangling-entry')} '${channel}' is adjudicated as dangling but is no longer in validChannels`);
    } else if (handlerChannels.has(channel)) {
      issues.push(`${FLAT_IPC_REGISTRY_PATH}: ${tag('stale-dangling-entry')} '${channel}' is adjudicated as dangling but now has an ipcMain.handle`);
    }
  }
  return issues;
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
  aliasTypeTexts = {},
  flatIpcRegistry,
  ipcMainHandleSites,
  preloadText,
}) {
  const issues = [];
  const contract = parseContractActions(contractText, aliasTypeTexts);
  const facade = parseFacadeActions(hostApiText);
  const registeredModules = parseRegisteredModules(ipcHandlersText);

  for (const [memberName, typeName] of parseContractAliasMembers(contractText)) {
    if (!contract.has(memberName)) {
      issues.push(`${CONTRACT_PATH}: [host-api/unresolved-alias-member] HostApiContract.${memberName} aliases type '${typeName}', which could not be resolved to an object type for reconciliation`);
    }
  }

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

  issues.push(...collectFlatIpcIssues({ contract, flatIpcRegistry, ipcMainHandleSites, preloadText }));

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
  collectFlatIpcIssues,
  inlineModuleFacadeAliases,
  parseContractActions,
  parseContractAliasMembers,
  parseContractTypeImports,
  parseFacadeActions,
  parseIpcMainHandleSites,
  parsePreloadAllowlist,
  parseRegisteredModules,
  parseRegistryScenarioIds,
};

async function listIpcSourceFiles(relativeRoot) {
  const [{ readdir }, { posix, resolve }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ]);
  const files = [];
  const isProductionFile = (name) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(name) && !/\.(?:test|spec|d)\.(?:[cm]?[jt]s|[jt]sx)$/.test(name);
  async function walk(relativeDir) {
    const entries = await readdir(resolve(ROOT, relativeDir), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = posix.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') continue;
        await walk(relativePath);
      } else if (isProductionFile(entry.name)) {
        files.push(relativePath);
      }
    }
  }
  if (ipcSourceSnapshot?.has(relativeRoot)) files.push(...ipcSourceSnapshot.get(relativeRoot));
  else {
    await walk(relativeRoot);
    ipcSourceSnapshot?.set(relativeRoot, [...files]);
  }
  for (const [file, mutations] of fileMutations) {
    if (file.startsWith(`${relativeRoot}/`) && posix.normalize(file) === file && isProductionFile(file)
      && !file.split('/').some((part) => ['node_modules', 'dist', '__tests__'].includes(part))
      && mutations.some((mutation) => typeof mutation.create === 'string')) files.push(file);
  }
  return [...new Set(files)].sort();
}

async function readAliasTypeTexts(contractText) {
  const { posix } = await import('node:path');
  const imports = parseContractTypeImports(contractText);
  const texts = {};
  for (const typeName of new Set(parseContractAliasMembers(contractText).values())) {
    const specifier = imports.get(typeName);
    if (!specifier) continue;
    const base = posix.normalize(posix.join(posix.dirname(CONTRACT_PATH), specifier));
    for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
      try {
        texts[candidate] = await readProjectFile(candidate);
        break;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
  return texts;
}

async function loadFixtures(paths) {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const ids = [];
  for (const path of paths) {
    const fixture = JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
    if (!Array.isArray(fixture.mutations) || fixture.mutations.length === 0) {
      throw new Error(`fixture ${path} declares no mutations`);
    }
    for (const mutation of fixture.mutations) {
      if (typeof mutation.file !== 'string') throw new Error(`fixture ${path}: mutation without file`);
      if (!fileMutations.has(mutation.file)) fileMutations.set(mutation.file, []);
      fileMutations.get(mutation.file).push(mutation);
    }
    ids.push(fixture.id ?? path);
  }
  return ids;
}

function parseArgs(argv) {
  const fixtures = [];
  const batch = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--fixture' || argv[index] === '--fixture-batch') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argv[index]} requires a path`);
      (argv[index] === '--fixture' ? fixtures : batch).push(value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argv[index]}`);
    }
  }
  if (fixtures.length && batch.length) throw new Error('--fixture and --fixture-batch cannot be combined');
  return { fixtures, batch };
}

async function runCheck(fixtures, output = console) {
  fileMutations.clear();
  consumedMutationFiles.clear();
  let fixtureIds = [];
  try {
    fixtureIds = await loadFixtures(fixtures);
  } catch (error) {
    output.error(`Contract check fixture error: ${error.message}`);
    return 2;
  }

  let files;
  try {
    const contractText = await readProjectFile(CONTRACT_PATH);
    const ipcMainHandleSites = [];
    for (const file of await listIpcSourceFiles(IPC_MAIN_SCAN_ROOT)) {
      const text = await readProjectFile(file);
      ipcMainHandleSites.push(...parseIpcMainHandleSites(text, file));
    }
    files = {
      contractText,
      aliasTypeTexts: await readAliasTypeTexts(contractText),
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
          knowledgeConnectorsApi: await readProjectFile('src/lib/host-api/knowledge/connectors.ts'),
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
      flatIpcRegistry: JSON.parse(await readProjectFile(FLAT_IPC_REGISTRY_PATH)),
      ipcMainHandleSites,
      preloadText: await readProjectFile('electron/preload/index.ts'),
    };
  } catch (error) {
    if (fixtureIds.length > 0 && /fixture mutation target not found/.test(error.message)) {
      output.error(`Contract check fixture error: ${error.message}`);
      return 2;
    }
    throw error;
  }

  const unconsumedMutations = [...fileMutations.keys()].filter((path) => !consumedMutationFiles.has(path));
  if (unconsumedMutations.length > 0) {
    output.error(`Contract check fixture error: fixture mutations target files the gate never reads: ${unconsumedMutations.join(', ')}`);
    return 2;
  }
  if (fixtureIds.length > 0) {
    output.error(`Contract check fixtures applied: ${fixtureIds.join(', ')}`);
  }
  const issues = collectContractIssues(files);
  if (issues.length > 0) {
    output.error('Contract check failed:');
    for (const issue of issues) output.error(`- ${issue}`);
    return 1;
  }
  output.log('Contract check passed.');
  return 0;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Contract check fixture error: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  if (!options.batch.length) {
    process.exitCode = await runCheck(options.fixtures);
    return;
  }
  projectSnapshot = new Map();
  ipcSourceSnapshot = new Map();
  ipcParseCache = new Map();
  const results = [];
  for (const fixture of options.batch) {
    const result = { fixture, code: 0, stdout: '', stderr: '' };
    const output = {
      log: (line) => { result.stdout += `${line}\n`; },
      error: (line) => { result.stderr += `${line}\n`; },
    };
    try {
      result.code = await runCheck([fixture], output);
    } catch (error) {
      result.code = 1;
      output.error(error.message);
    }
    results.push(result);
  }
  console.log(JSON.stringify({ results }));
  process.exitCode = Math.max(...results.map((result) => result.code));
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
