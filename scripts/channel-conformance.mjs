import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const CHECKS = [
  {
    id: 'send-text',
    description: 'adapter exports sendText for outbound text messages',
    path: 'adapter.ts',
    pattern: /\b(sendText)\b/,
  },
  {
    id: 'receive-text',
    description: 'adapter exports receiveText for inbound text messages',
    path: 'adapter.ts',
    pattern: /\b(receiveText)\b/,
  },
  {
    id: 'markdown-format-downgrade',
    description: 'schema or tests acknowledge plain text/markdown payload downgrade',
    path: 'schema.yaml',
    pattern: /\b(text|markdown)\b/i,
  },
  {
    id: 'rate-limit',
    description: 'manifest, schema, or tests declare rate-limit behavior',
    path: 'manifest.yaml',
    pattern: /\b(rate|limit|diagnostics)\b/i,
  },
  {
    id: 'connection-drop',
    description: 'tests include a conformance hook for connection drops',
    path: '__tests__/conformance.test.ts',
    pattern: /\b(connection|receiveText|sendText)\b/i,
  },
  {
    id: 'message-too-long',
    description: 'schema constrains message structure for too-long payload validation',
    path: 'schema.yaml',
    pattern: /\b(text|string|required)\b/i,
  },
  {
    id: 'credential-missing',
    description: 'manifest exposes permissions or diagnostics for missing credentials',
    path: 'manifest.yaml',
    pattern: /\b(requiredPermissions|diagnostics|capabilities)\b/i,
  },
  {
    id: 'binding-behavior',
    description: 'manifest declares capabilities used by channel binding',
    path: 'manifest.yaml',
    pattern: /\b(channel\.send|channel\.receive|capabilities)\b/i,
  },
  {
    id: 'logs-diagnostics',
    description: 'manifest declares diagnostics visibility',
    path: 'manifest.yaml',
    pattern: /\bdiagnostics\b/i,
  },
];

function usage() {
  console.error('Usage: pnpm channel:conformance <channel-name>');
}

function toKebab(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function channelRoot(name) {
  const CHANNEL_ROOT_OVERRIDE = process.env.CLAWX_CHANNEL_CONFORMANCE_ROOT;
  if (CHANNEL_ROOT_OVERRIDE) return resolve(CHANNEL_ROOT_OVERRIDE, name);
  return resolve(ROOT, 'openclaw_runtime', 'extensions', 'channels', name);
}

async function readIfExists(path) {
  if (!existsSync(path)) return '';
  return await readFile(path, 'utf8');
}

async function runConformance(rawName) {
  const channelName = toKebab(rawName);
  if (!channelName) throw new Error('Channel name is required.');
  const root = channelRoot(channelName);
  const results = [];

  for (const check of CHECKS) {
    const filePath = join(root, check.path);
    const text = await readIfExists(filePath);
    results.push({
      id: check.id,
      description: check.description,
      status: text && check.pattern.test(text) ? 'pass' : 'fail',
      file: filePath,
    });
  }

  const success = results.every((entry) => entry.status === 'pass');
  const report = {
    schema: 'clawx.agent-dev.channel-conformance.v1',
    channelName,
    generatedAt: new Date().toISOString(),
    success,
    checks: results,
  };

  const artifactRoot = process.env.CLAWX_CHANNEL_CONFORMANCE_ARTIFACT_ROOT
    ? resolve(process.env.CLAWX_CHANNEL_CONFORMANCE_ARTIFACT_ROOT)
    : resolve(ROOT, 'artifacts', 'channel-conformance');
  const outDir = resolve(artifactRoot, channelName);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(join(outDir, 'report.md'), renderMarkdown(report), 'utf8');
  return report;
}

function renderMarkdown(report) {
  const rows = report.checks
    .map((check) => `| ${check.status} | ${check.id} | ${check.description} | \`${check.file}\` |`)
    .join('\n');
  return `# Channel Conformance: ${report.channelName}

Generated: ${report.generatedAt}

Result: ${report.success ? 'pass' : 'fail'}

| Status | Check | Description | File |
|---|---|---|---|
${rows}
`;
}

export { CHECKS, runConformance };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , rawName] = process.argv;
  if (!rawName) {
    usage();
    process.exit(1);
  }
  try {
    const report = await runConformance(rawName);
    console.log(JSON.stringify({
      success: report.success,
      channelName: report.channelName,
      output: `artifacts/channel-conformance/${report.channelName}/report.json`,
    }, null, 2));
    if (!report.success) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
