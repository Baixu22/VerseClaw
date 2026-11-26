import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runRagCommand } from './lib/project-rag-process.mjs';
import { readFile, rename, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { readProjectRagAcceptance, RAG_SOAK_MINIMUM_MS, validateRagSoak, validateRagSoakProbe } from './lib/project-rag-acceptance.mjs';

const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const json = async (file: string) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
async function save(file: string, value: unknown) {
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, file);
}

type ProbeResult = { candidate: string; status: string; lostJobs: number; duplicatePublications: number;
  revocationLeaks: number; pendingJobs: number };
async function runProbe(argv: string[], cwd: string, report: string, log: string, timeoutMs: number) {
  const result = await runRagCommand(argv, { cwd, log, timeoutMs,
    env: { ...process.env, TEMP: process.platform === 'win32' ? 'D:/tmp' : process.env.TEMP,
      TMP: process.platform === 'win32' ? 'D:/tmp' : process.env.TMP, RAG_SOAK_PROBE_REPORT: report } });
  if (result.timedOut || result.exitCode !== 0) throw new Error(result.timedOut ? 'Soak probe timed out' : `Soak probe failed with ${result.exitCode}`);
  return await json(report) as ProbeResult;
}

async function soak(planPath: string, directory: string) {
  const plan = await json(planPath);
  if (plan.schema !== 'ProjectRagSoakPlan/v1' || plan.minimumDurationMs !== RAG_SOAK_MINIMUM_MS
    || !Array.isArray(plan.argv) || !plan.argv.length || !plan.argv.every((part: unknown) => typeof part === 'string')
    || !Number.isSafeInteger(plan.intervalMs) || plan.intervalMs < 1000 || plan.intervalMs > 300000
    || !Number.isSafeInteger(plan.probeTimeoutMs) || plan.probeTimeoutMs <= 0 || plan.probeTimeoutMs > 300000)
    throw new Error('Soak requires the frozen 72-hour duration and bounded probe/interval');
  const root = resolve(plan.root);
  if (git(root, 'rev-parse', 'HEAD') !== plan.candidate || git(root, 'status', '--porcelain')) throw new Error('Soak candidate must be clean and frozen');
  if (!Array.isArray(plan.inputs) || !plan.inputs.length) throw new Error('Soak probe and build inputs must be pinned');
  const verify = async () => {
    if (git(root, 'rev-parse', 'HEAD') !== plan.candidate || git(root, 'status', '--porcelain')) throw new Error('Soak candidate changed');
    for (const input of plan.inputs) if (digest(await readFile(resolve(root, input.path))) !== input.sha256) throw new Error('Soak input changed');
  };
  await mkdir(directory, { recursive: false });
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  const started = performance.now();
  const report = { schema: 'ProjectRagSoak/v1', actor: 'codex/project-rag-soak', driven_by: 'agent',
    candidate: plan.candidate, status: 'running', startedAt: new Date().toISOString(),
    maximumGapMs: plan.intervalMs + plan.probeTimeoutMs, activeElapsedMs: 0,
    samples: [] as Array<ProbeResult & { sequence: number; recordedAt: string; monotonicElapsedMs: number; probeDigest: string; probeFile: string }>,
    error: null as string | null };
  try {
    do {
      await verify();
      const sequence = report.samples.length;
      const probeFile = join(directory, `probe-${String(sequence).padStart(5, '0')}.json`);
      const value = await runProbe(plan.argv, root, probeFile, join(directory, `probe-${sequence}.log`), plan.probeTimeoutMs);
      if (value.candidate !== plan.candidate || validateRagSoakProbe(value).length)
        throw new Error('Actual soak probe reported an invariant failure');
      await verify();
      report.activeElapsedMs = performance.now() - started;
      report.samples.push({ candidate: value.candidate, status: value.status, lostJobs: value.lostJobs,
        duplicatePublications: value.duplicatePublications, revocationLeaks: value.revocationLeaks, pendingJobs: value.pendingJobs,
        sequence, recordedAt: new Date().toISOString(),
        monotonicElapsedMs: report.activeElapsedMs, probeDigest: digest(await readFile(probeFile)), probeFile });
      await save(join(directory, 'report.json'), report);
      if (report.activeElapsedMs - report.samples[0].monotonicElapsedMs >= RAG_SOAK_MINIMUM_MS) break;
      await new Promise(resolve => setTimeout(resolve, plan.intervalMs));
    } while (report.status === 'running');
    report.status = 'completed';
    const errors = validateRagSoak(report);
    if (errors.length) throw new Error(errors.join(', '));
  } catch (error) { report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); throw error; }
  finally { await save(join(directory, 'report.json'), report); }
}

async function main() {
  const [mode, input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: knowledge-rag-acceptance readback <manifest> <output> | soak <plan> <new-directory>');
  if (mode === 'soak') { await soak(resolve(input), resolve(output)); return; }
  if (mode !== 'readback') throw new Error('Unknown RAG acceptance command');
  const report = await readProjectRagAcceptance(dirname(resolve(input)), await json(resolve(input)));
  await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  if (report.status !== 'passed') process.exitCode = 1;
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
