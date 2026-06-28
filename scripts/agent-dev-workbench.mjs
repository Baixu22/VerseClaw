#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const CONTRACT_PATH = resolve(ROOT, 'shared/host-api/contract.ts');
const OUT_DIR = resolve(ROOT, 'artifacts/agent-dev-workbench');
const OUT_FILE = resolve(OUT_DIR, 'index.html');

function extractScenarioIds(contractText) {
  const match = contractText.match(/export type AgentDevScenarioId =([\s\S]*?);/);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function routeForScenario(id) {
  if (id === 'models-heavy-usage' || id === 'settings-provider-error') return '/settings/models';
  if (id === 'doctor-failed') return '/settings/advanced';
  if (id === 'knowledge-drafts') return '/knowledge';
  if (id === 'observability-trace-errors') return '/observability';
  return '/';
}

function renderHtml(ids) {
  const rows = ids.map((id) => {
    const route = routeForScenario(id);
    const href = `${route}?e2eSkipSetup=1&devScenario=${encodeURIComponent(id)}&visual=1`;
    return `<tr><td><code>${id}</code></td><td><code>${route}</code></td><td><a href="${href}">open</a></td></tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent Dev Workbench</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #111827; }
    h1 { font-size: 24px; font-weight: 500; margin: 0 0 16px; }
    p { max-width: 760px; color: #4b5563; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; margin-top: 24px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 10px 12px; text-align: left; }
    th { color: #374151; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    code { background: #f3f4f6; border-radius: 4px; padding: 2px 5px; }
    a { color: #2563eb; text-decoration: none; }
  </style>
</head>
<body>
  <h1>Agent Dev Workbench</h1>
  <p>This generated index lists all typed <code>devScenario</code> entry points. Start the app with <code>pnpm dev</code>, then open these paths inside the app browser or normal browser session.</p>
  <table>
    <thead><tr><th>Scenario</th><th>Route</th><th>Link</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
}

const contract = await readFile(CONTRACT_PATH, 'utf8');
const ids = extractScenarioIds(contract);
if (ids.length === 0) {
  throw new Error('No AgentDevScenarioId entries found.');
}
await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, renderHtml(ids), 'utf8');
console.log(JSON.stringify({ success: true, scenarioCount: ids.length, output: OUT_FILE }, null, 2));
