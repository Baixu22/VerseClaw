import { describe, expect, it } from 'vitest';
import {
  documentDigest,
  validateCleanup,
  validateElectronStartup,
  validateSmokeResults,
} from '../../scripts/versegit-product-a2-evidence.mjs';

function sign<T extends Record<string, unknown>>(document: T): T & { digest: string } {
  return Object.assign(document, { digest: documentDigest(document) });
}

function smoke() {
  const tests = [
    'shows the setup wizard on a fresh profile',
    'can skip setup and navigate to the models page',
    'persists skipped setup across relaunch for the same isolated profile',
    'invokes the real typed host bridge for app version',
    'does not show a fatal dialog when an E2E output pipe closes',
  ].map((title) => ({ title, ok: true, status: 'passed', duration_ms: 1 }));
  return sign({
    schema: 'clawx.versegit.product-a2-evidence/v1',
    kind: 'smoke-results',
    task: 'TF-0525',
    driven_by: 'agent',
    actor: 'playwright-runner',
    stats: { expected: 5, unexpected: 0, skipped: 0, flaky: 0 },
    tests,
    entered_test_body: true,
  });
}

describe('VerseGit A2 runtime baseline evidence', () => {
  it('accepts only five real app-smoke tests including first window and host invoke', () => {
    const document = smoke();
    expect(validateSmokeResults(document).issues).toEqual([]);
    const failed = structuredClone(document);
    failed.stats.unexpected = 1;
    failed.tests[3].ok = false;
    sign(failed);
    expect(validateSmokeResults(failed).issues).toContain('smoke stats are not clean');
    expect(validateSmokeResults(failed).issues).toContain('smoke test set did not pass');
  });

  it('keeps historical EPERM separate from current diagnostic probes and formal smoke', () => {
    const document = sign({
      schema: 'clawx.versegit.product-a2-evidence/v1',
      kind: 'electron-startup',
      task: 'TF-0525',
      driven_by: 'agent',
      actor: 'codex',
      diagnostics: {
        writable_isolated_root: { write: { ok: true }, window: { ok: true } },
        historical_eperm: { status: 'observed', current_source: false },
      },
      actual_app_smoke: { expected: 5, failed: 0, entered_test_body: true, first_window_covered: true, host_invoke_covered: true },
      boundaries: { real_human_evidence: false, m4_authorized: false },
    });
    expect(validateElectronStartup(document).issues).toEqual([]);
    const promoted = structuredClone(document);
    promoted.diagnostics.historical_eperm.current_source = true;
    sign(promoted);
    expect(validateElectronStartup(promoted).issues).toContain('historical EPERM baseline is missing or mislabelled');
  });

  it('fails closed on Electron survivors or cleanup sweep residue', () => {
    const document = sign({
      schema: 'clawx.versegit.product-a2-evidence/v1',
      kind: 'cleanup',
      task: 'TF-0525',
      driven_by: 'agent',
      actor: 'codex',
      survivors: [] as number[],
      pid_checks: [{ pid: 42, alive_after: false }],
      sweep: { status: 'ok', remaining: 0 },
      source_modified_by_cleanup: false,
    });
    expect(validateCleanup(document).issues).toEqual([]);
    const survivor = structuredClone(document);
    survivor.survivors = [42];
    survivor.pid_checks[0].alive_after = true;
    survivor.sweep.remaining = 1;
    sign(survivor);
    expect(validateCleanup(survivor).issues).toEqual(expect.arrayContaining([
      'cleanup process survivors remain',
      'a recorded Electron PID is still alive',
      'cleanup sweep is incomplete',
    ]));
  });
});
