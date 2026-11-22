#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const upstreamPath = process.argv[2] ?? process.env.KITESURF_UPSTREAM_ROOT;
assert.ok(upstreamPath, 'Usage: node --use-env-proxy scripts/kitesurf-local-runtime.mjs <built-kitesurf-checkout>');
const upstreamRoot = resolve(upstreamPath);
const engineRoot = join(upstreamRoot, 'packages/engine');
const require = createRequire(join(engineRoot, 'package.json'));
const { createTestHarness, unstable_readConfig } = require('wrangler');
const configPath = join(engineRoot, 'wrangler.jsonc');
const config = unstable_readConfig({ config: configPath, env: 'local' });
assert.ok(config.compatibility_flags.includes('global_fetch_strictly_public'));
assert.notEqual(config.vars.KITESURF_ALLOW_PRIVATE_NETWORK, '1');
const revision = execFileSync('git', ['-C', upstreamRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(revision, '4a2903813a22b08d4f3cc64a4b35339d0293a5d1');

// Wrangler's local test server forwards real egress through Node fetch.
// Start Node with --use-env-proxy to use the host's existing proxy settings.
const runtime = createTestHarness({ root: engineRoot, workers: [
  { configPath, env: 'local' },
  { configPath: join(engineRoot, 'test/fixtures-worker/wrangler.jsonc') },
] });
try {
  const { url } = await runtime.listen();
  const endpoint = new URL('/devtools/browser', url);
  endpoint.protocol = 'ws:';
  console.log(JSON.stringify({ driven_by: 'agent', actor: 'codex', processId: process.pid,
    upstreamRevision: revision, url: url.href, endpoint: endpoint.href,
    privateNetworkEnabled: false, remoteBrowserRun: false }));
} catch (error) {
  runtime.debug();
  await runtime.close();
  throw error;
}
let stopping;
const stop = () => { stopping ??= runtime.close().catch(error => { console.error(error); process.exitCode = 1; }); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
