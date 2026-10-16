#!/usr/bin/env node
// M11 rehearsal: enable the upstream (new) backend for NEW sessions only, prove old sessions stay on
// the legacy engine with no page/ref/cursor reuse, and prove a broken upstream fails closed without
// silently switching executors. The product default stays legacy (no default change here).
import { createServer } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const PACKAGE_ROOT = 'packages/versebrowser';

function refOf(snapshot, label) {
  const text = String(snapshot?.data?.snapshot ?? '');
  const line = text.split('\n').find((l) => l.includes(label)) ?? '';
  return (line.match(/\[([^\]\s]+)\]/) ?? [])[1];
}

export async function rehearseCutover({ hostRoot = ROOT } = {}) {
  const require = createRequire(join(hostRoot, PACKAGE_ROOT, 'package.json'));
  const standalone = await import(pathToFileURL(join(hostRoot, PACKAGE_ROOT, 'dist', 'engine', 'standalone.js')).href);
  const { createStandaloneFacade } = standalone;

  const fixture = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>M11 Fixture</title><h1>M11 CUTOVER FIXTURE</h1><button id="go">Go</button><form onsubmit="return false"><input id="q" name="q"><button>Submit</button></form>');
  });
  await new Promise((d) => fixture.listen(0, '127.0.0.1', d));
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  const stamp = `${Date.now()}-${process.pid}`;
  const roots = ['legacy', 'upstream', 'broken'].map((n) => join(hostRoot, '.tmp', `m11-${n}-${stamp}`));
  for (const r of roots) await mkdir(r, { recursive: true });

  const report = { schemaVersion: 1, artifact: 'versebrowser-m11-cutover-rehearsal', driven_by: 'agent', actor: 'codex', fixtureUrl: url, steps: {}, checks: {} };
  let legacy, upstream, broken;
  try {
    const defaultFacade = await createStandaloneFacade({ workspaceRoot: roots[0] });
    report.steps.defaultDriver = defaultFacade.driver;
    report.steps.defaultDriverIsLegacy = defaultFacade.driver === 'playwright';
    await defaultFacade.facade.dispose?.().catch(() => undefined);

    legacy = (await createStandaloneFacade({ backend: 'legacy', workspaceRoot: roots[0] })).facade;
    upstream = (await createStandaloneFacade({ backend: 'upstream', workspaceRoot: roots[1], allowedOrigins: [new URL(url).origin] })).facade;

    const a = await legacy.open({ url, mode: 'headless' });
    const b = await upstream.open({ url, mode: 'headless' });
    const sidA = a.data?.session?.id;
    const sidB = b.data?.session?.id;
    report.steps.legacyOpenOk = a.ok === true;
    report.steps.upstreamOpenOk = b.ok === true;

    const snapA = await legacy.snapshot(sidA);
    const snapB = await upstream.snapshot(sidB);
    const refA = refOf(snapA, 'Go');
    const refB = refOf(snapB, 'Go');
    report.steps.refA = refA;
    report.steps.refB = refB;

    // Old session ids are not resolvable from the other engine; a foreign cursor is not accepted.
    report.steps.legacyClickForeignSession = await legacy.click(sidB, refB).then((r) => ({ ok: r.ok, code: r.error?.code })).catch((e) => ({ threw: String(e.message) }));
    report.steps.upstreamClickForeignSession = await upstream.click(sidA, refA).then((r) => ({ ok: r.ok, code: r.error?.code })).catch((e) => ({ threw: String(e.message) }));
    report.steps.legacyCloseForeignSession = await legacy.close(sidB).then((r) => ({ ok: r.ok, code: r.error?.code })).catch((e) => ({ threw: String(e.message) }));
    const curA = (await legacy.networkList(sidA)).data?.cursor;
    report.steps.legacyCursor = curA;
    report.steps.upstreamAcceptsForeignCursor = await upstream.networkWait({ sessionId: sidB, sinceCursor: curA, timeoutMs: 500 }).then((r) => ({ ok: r.ok, code: r.error?.code })).catch((e) => ({ threw: String(e.message) }));

    await legacy.close(sidA);
    await upstream.close(sidB);

    // Fault injection: an upstream engine with an unusable browser must fail, not fall back to legacy.
    const brokerRoot = join(hostRoot, '.tmp', `m11-broken-${stamp}`);
    broken = (await createStandaloneFacade({ backend: 'upstream', workspaceRoot: roots[2], executablePath: join(brokerRoot, 'no-such-chrome.exe'), allowedOrigins: [new URL(url).origin] })).facade;
    report.steps.brokenUpstreamOpen = await broken.open({ url, mode: 'headless' }).then((r) => ({ ok: r.ok, code: r.error?.code, content: String(r.content ?? '').slice(0, 90) })).catch((e) => ({ threw: String(e.message).slice(0, 90) }));
    report.steps.brokenUpstreamSessionExists = await broken.sessionExists?.('none') ?? null;
  } catch (error) {
    report.steps.error = String(error?.message ?? error);
  } finally {
    await legacy?.dispose?.().catch(() => undefined);
    await upstream?.dispose?.().catch(() => undefined);
    await broken?.dispose?.().catch(() => undefined);
    await new Promise((d) => fixture.close(d));
    for (const r of roots) await rm(r, { recursive: true, force: true }).catch(() => undefined);
  }

  const s = report.steps;
  report.checks = {
    default_backend_still_legacy: s.defaultDriverIsLegacy === true,
    legacy_and_upstream_sessions_open: s.legacyOpenOk === true && s.upstreamOpenOk === true,
    legacy_rejects_foreign_session: s.legacyClickForeignSession?.ok === false && s.legacyCloseForeignSession?.ok === false,
    upstream_rejects_foreign_session: s.upstreamClickForeignSession?.ok === false,
    upstream_rejects_foreign_cursor: s.upstreamAcceptsForeignCursor?.ok === false,
    broken_upstream_fails_closed: s.brokenUpstreamOpen?.ok === false,
  };
  report.status = Object.values(report.checks).every(Boolean) ? 'pass' : 'fail';
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { 'host-root': { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
  const report = await rehearseCutover({ hostRoot: values['host-root'] });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(resolve(values.output), text, 'utf8');
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });