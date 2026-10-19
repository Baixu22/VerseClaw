// @vitest-environment node
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TimerAligner } from '../../shared/resources/timer-aligner';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function busy(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* synthetic CPU work */ }
}

describe('TimerAligner shed pressure', () => {
  it('reduces synthetic non-interactive CPU work by at least 30% while shedding', async () => {
    const aligner = new TimerAligner({ tickMs: 250 });
    let runs = 0;
    const unregister = Array.from({ length: 6 }, (_, index) => aligner.register({
      id: `shed-task-${index}`,
      intervalMs: 500,
      priority: 'background',
      run: () => { runs += 1; busy(5); },
    }));
    await sleep(500);
    const unshedRunsStart = runs;
    const unshedCpuStart = process.cpuUsage();
    await sleep(1_500);
    const unshedRuns = runs - unshedRunsStart;
    const unshedCpu = process.cpuUsage(unshedCpuStart);

    aligner.setShedding(true);
    const shedRunsStart = runs;
    const shedCpuStart = process.cpuUsage();
    await sleep(1_500);
    const shedRuns = runs - shedRunsStart;
    const shedCpu = process.cpuUsage(shedCpuStart);
    for (const stop of unregister) stop();

    const unshedCpuMs = (unshedCpu.user + unshedCpu.system) / 1000;
    const shedCpuMs = (shedCpu.user + shedCpu.system) / 1000;
    const report = {
      schema: 'clawx.tf0400.timer-shed-pressure/v1',
      driven_by: 'agent',
      actor: 'codex-tf0400',
      generatedAt: new Date().toISOString(),
      windowMs: 1_500,
      tasks: 6,
      taskIntervalMs: 500,
      busyMsPerTask: 5,
      unshedRuns,
      shedRuns,
      unshedCpuMs,
      shedCpuMs,
      cpuReductionRatio: unshedCpuMs === 0 ? null : 1 - shedCpuMs / unshedCpuMs,
    };
    const output = process.env.RESOURCE_TIMER_SHED_OUT;
    if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    expect(shedRuns).toBeLessThan(unshedRuns * 0.5);
    expect(shedCpuMs).toBeLessThan(unshedCpuMs * 0.7);
  }, 15_000);
});