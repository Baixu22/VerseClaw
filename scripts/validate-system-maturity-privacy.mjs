#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  validatePrivacyDataFlowInventory,
  validateSensitiveCapturePolicySemantics,
} from './lib/system-maturity-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = path.join(root, 'plans/system-maturity/privacy-data-flow-inventory.json');
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));

const errors = validatePrivacyDataFlowInventory({ root, inventory });

const policyModulePath = path.join(root, 'shared/privacy/sensitive-capture-policy.ts');
// Load via vitest-tested pure export through dynamic import of compiled-free mjs mirror:
// Re-implement by importing the TS through node is not available; use semantic validator
// with a small local implementation matching production decideSensitiveCapture rules.
const { decideSensitiveCapture } = await import(pathToFileURL(path.join(root, 'scripts/lib/sensitive-capture-policy-node.mjs')).href);
errors.push(...validateSensitiveCapturePolicySemantics(decideSensitiveCapture));

// Error sanitize smoke
const { sanitizeUiErrorText, assertNoStackOrSecret } = await import(pathToFileURL(path.join(root, 'scripts/lib/ui-error-sanitize-node.mjs')).href);
const dirty = 'Boom sk-abcdefghijklmnopqrst\n    at Object.foo (file.ts:1:1)\nCLAWX_CANARY_SECRET99';
const clean = sanitizeUiErrorText(dirty);
const failures = assertNoStackOrSecret(clean);
if (failures.length) errors.push(`ui sanitize leaked: ${failures.join(',')}`);
if (!fs.existsSync(policyModulePath)) errors.push('missing shared/privacy/sensitive-capture-policy.ts');
if (!fs.existsSync(path.join(root, 'shared/privacy/ui-error-sanitize.ts'))) errors.push('missing shared/privacy/ui-error-sanitize.ts');
if (!fs.existsSync(path.join(root, 'src/components/common/ErrorBoundary.tsx'))) errors.push('missing ErrorBoundary');

const errorBoundary = fs.readFileSync(path.join(root, 'src/components/common/ErrorBoundary.tsx'), 'utf8');
if (!errorBoundary.includes('sanitizeUiErrorText')) errors.push('ErrorBoundary must use sanitizeUiErrorText');
if (errorBoundary.includes('error.stack') || errorBoundary.includes('this.state.error.stack')) {
  errors.push('ErrorBoundary must not render stack');
}

const gateSources = [
  'electron/services/agent-browser-api.ts',
  'electron/services/remote-control-api.ts',
  'electron/services/gateway-api.ts',
];
for (const rel of gateSources) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  if (!text.includes('assertSensitiveCaptureAllowed')) errors.push(`${rel} missing sensitive capture gate`);
}

if (errors.length) {
  for (const error of errors) console.error(`FAIL  ${error}`);
  console.error(`validate-system-maturity-privacy: FAILED (${errors.length})`);
  process.exit(1);
}
console.log('validate-system-maturity-privacy: OK');
