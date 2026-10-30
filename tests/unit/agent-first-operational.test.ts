// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyOperationalAcceptance } from '../../scripts/agent-first-operational-check.mjs';
import { sha256 } from '../../scripts/lib/agent-first-task-corpus.mjs';

const root = process.cwd();
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();

function fixture() {
  const dir = mkdtempSync('D:/tmp/agent-first-operational-test-');
  mkdirSync(dir, { recursive: true });
  const write = (name: string, value: unknown) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); return { path: name, sha256: sha256(readFileSync(path)) }; };
  const candidate = { commit, tree, dirty: false };
  const operational = write('operational.json', {
    schemaVersion: 'AgentFirstOperationalAcceptance/v1', driven_by: 'agent', actor: 'test/oat', candidate,
    source: { core: { taskStatus: 'cancelled', gatewayReady: true, theme: 'light' }, drills: {
      gatewayLoss: { observed: true, portClosed: true }, gatewayRecovery: { state: 'running' },
      gatewayStartupFailure: { observed: true, recovered: true }, diagnostics: { observed: true },
      writeFailure: { observed: true, recoveryExport: true }, restart: { observed: true },
      crashRecovery: { observed: true, recovered: true },
    }, cleanup: { appExitObserved: true, gatewayPortClosed: true, crashRelaunchClean: true } },
    packaged: null, verdict: { operational: 'pass', distribution: 'not-run' }, distribution: { status: 'not-run' },
    claims: { realHuman: false, releaseApproved: false, signedInstaller: false, crossPlatform: false },
  });
  const providerFaults = write('provider-faults.json', {
    driven_by: 'agent', actor: 'test/provider', candidate, status: 'pass', cases: [
      { type: 'timeout', status: 'pass', faultRequests: 2, runtimeProbe: { settled: true }, recovery: { messages: [{ role: 'assistant', stopReason: 'stop' }] } },
      { type: 'cancel', status: 'pass', faultRequests: 1, runtimeProbe: { settled: true }, recovery: { messages: [{ role: 'assistant', stopReason: 'stop' }] } },
    ],
  });
  const acceptance = {
    schemaVersion: 'AgentFirstOperationalEvidence/v1', driven_by: 'agent', actor: 'test/acceptance', candidate,
    artifacts: { operational, providerFaults }, requiredDrills: ['gatewayLoss', 'gatewayRecovery', 'gatewayStartupFailure', 'diagnostics', 'writeFailure', 'restart', 'crashRecovery'],
    requiredProviderFaults: ['timeout', 'cancel'], claims: { realHuman: false, releaseApproved: false, signedProduct: false },
  };
  writeFileSync(join(dir, 'acceptance.json'), JSON.stringify(acceptance, null, 2) + '\n');
  return { dir, acceptancePath: join(dir, 'acceptance.json'), operationalPath: join(dir, 'operational.json') };
}

describe('Agent First operational acceptance evidence', () => {
  it('verifies source OAT, provider fault recovery and cleanup', () => {
    const value = fixture();
    expect(verifyOperationalAcceptance(value.acceptancePath, root)).toMatchObject({ drills: 7, providerFaults: 2, distribution: 'not-run' });
  });

  it('rejects changed drill evidence and overclaims', () => {
    const changed = fixture();
    const operational = JSON.parse(readFileSync(changed.operationalPath, 'utf8'));
    operational.source.drills.writeFailure.observed = false;
    writeFileSync(changed.operationalPath, JSON.stringify(operational, null, 2) + '\n');
    expect(() => verifyOperationalAcceptance(changed.acceptancePath, root)).toThrow('operational evidence changed');

    const overclaim = fixture();
    const value = JSON.parse(readFileSync(overclaim.acceptancePath, 'utf8'));
    value.claims.realHuman = true;
    writeFileSync(overclaim.acceptancePath, JSON.stringify(value, null, 2) + '\n');
    expect(() => verifyOperationalAcceptance(overclaim.acceptancePath, root)).toThrow('overclaims');
  });
});