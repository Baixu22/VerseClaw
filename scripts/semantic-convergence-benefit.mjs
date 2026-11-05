import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prefix = 'docs/dev/evidence/semantic-convergence-20261104/';
const read = file => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
export const FROZEN_WEIGHTS = Object.freeze({ correctness: 0.35, userImpact: 0.25, coverage: 0.20,
  costEfficiency: 0.10, evidenceQuality: 0.10 });

export function weightedBounds(weights, dimensions) {
  assert.deepEqual(weights, FROZEN_WEIGHTS, 'frozen weights changed');
  let lower = 0;
  let upper = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = dimensions[key];
    if (value === null) { upper += weight; continue; }
    assert(Number.isFinite(value) && value >= 0 && value <= 1, 'invalid dimension ' + key);
    lower += weight * value;
    upper += weight * value;
  }
  return { lower: Number(lower.toFixed(8)), upper: Number(upper.toFixed(8)) };
}

export function buildBenefitReport() {
  const inputPaths = [prefix + 'tf-0747/baseline-m0.json', prefix + 'tf-0746/report.json',
    prefix + 'tf-0746/matrix.json', prefix + 'tf-0746/commands.json', prefix + 'tf-0746/http-observations.json',
    prefix + 'tf-0746/negative-cases.json', prefix + 'tf-0746/electron-verdicts.json'];
  const [baseline, matrixReport, matrix, commands, http, negatives, electron] = inputPaths.map(read);
  assert.deepEqual(baseline.metricContract.scoreWeights, FROZEN_WEIGHTS);
  assert(matrix.rows.every(row => row.verdict === 'pass'));
  assert(negatives.cases.every(row => row.status === 'passed'));
  assert(electron.tests.every(row => row.status === 'passed'));
  assert(commands.gates.every(gate => gate.exitCode === 0 && gate.sourceStable && gate.candidate.dirty === false));
  const findingIds = [...new Set(matrix.rows.filter(row => row.finding !== 'OPS').map(row => row.finding))];
  assert.equal(findingIds.length, matrixReport.findings);
  const recovered = http.observations.find(row => row.recovered);
  assert(recovered && recovered.physicalRequests > 0);
  const after = [
    { id: 'retry-amplification', value: recovered.chargedAttempts / recovered.physicalRequests, unit: 'charges per physical request', method: 'real-local-HTTP', source: 'tf-0746/http-observations.json', liveUserBenefit: false },
    { id: 'retry-recovered', value: Number(recovered.recovered), unit: 'local fault sequence', method: 'real-local-HTTP', source: 'tf-0746/http-observations.json', liveUserBenefit: false },
    { id: 'root-runtime-pass-count', value: matrixReport.totalPassed, unit: 'assertions', method: 'same-candidate-test-results', source: 'tf-0746/report.json', liveUserBenefit: false },
    { id: 'electron-pass-count', value: electron.tests.length, unit: 'distinct journeys', method: 'real-Electron-Main-local-HTTP', source: 'tf-0746/electron-verdicts.json', liveUserBenefit: false },
    { id: 'negative-pass-rate', value: negatives.cases.filter(row => row.status === 'passed').length / negatives.cases.length, unit: 'declared negative/boundary cases', method: 'retained-case-results', source: 'tf-0746/negative-cases.json', liveUserBenefit: false },
  ];
  const dimensions = { correctness: findingIds.length / matrixReport.findings, userImpact: null,
    coverage: matrix.rows.filter(row => row.verdict === 'pass').length / matrix.rows.length,
    costEfficiency: null, evidenceQuality: commands.gates.filter(gate => gate.exitCode === 0 && gate.sourceStable).length / commands.gates.length };
  const times = commands.gates.map(gate => gate.durationMs);
  const started = commands.gates.map(gate => Date.parse(gate.startedAt));
  const ended = commands.gates.map(gate => Date.parse(gate.completedAt));
  return {
    schema: 'SemanticConvergenceBenefitReport/v1', node: 'TF-0747', driven_by: 'agent', actor: 'codex/semantic-program',
    measurementCandidate: matrixReport.candidate,
    inputs: inputPaths.map(file => ({ file, sha256: createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex') })),
    baseline: { candidate: baseline.candidate, metrics: baseline.metrics,
      limitation: 'Historical source-derived M0 snapshot; dirty=true. Preserved unchanged, not a clean paired benchmark. Counts use their original definitions (including MEM-1=5 labels, not the plan shorthand of 3 sites).' },
    findings: findingIds.map(id => ({ id, verdict: 'resolved-with-boundary', rows: matrix.rows.filter(row => row.finding === id),
      limitation: id.startsWith('M') ? 'Recovery-precondition/static disposition; persist stays retired.' : id.startsWith('P') ? 'Explicit enforce/seal scenarios; defaults remain warn/off, not universal live enforcement.' : 'Local automated scenarios; no live-user before/after performance claim.' })),
    observedAfter: after,
    comparisons: { pairedLiveUserSampleCount: 0, measuredLiveUserImpact: null, measuredDollarSavings: null,
      policy: 'No subtraction across static counts and behavioral outcomes or across different fixtures/candidates. Historical before and current after are reported independently.' },
    score: { weights: FROZEN_WEIGHTS, dimensions, interval: weightedBounds(FROZEN_WEIGHTS, dimensions),
      interpretation: 'Repair-evidence score for ordering only. Missing impact/cost dimensions are bounded 0..1. This interval is not a confidence interval, measured benefit percentage, or release approval.',
      definitions: { correctness: 'verified finding closure fraction', coverage: 'final matrix rows with pass verdict / all rows', evidenceQuality: 'clean source-stable successful gates / retained final gates',
        userImpact: 'unavailable: no paired live-user outcome samples', costEfficiency: 'unavailable: no paired production resource/dollar samples' } },
    verificationCost: { aggregateGateMs: times.reduce((a, b) => a + b, 0), observedGateWindowMs: Math.max(...ended) - Math.min(...started),
      limitation: 'Sum includes concurrent gate durations, not elapsed development time or dollars; window covers retained final gates only. Failed/review/development attempts are additional costs, not savings.' },
    decision: { status: 'keep-retired', persist: false, defaultChanges: { proposed: [], applied: [] }, productLocksChanged: false, releaseReady: false, realHumanEvidence: false },
    unmeasured: ['Live-provider reliability, latency, billed tokens and dollars', 'Live-user improvement and long-term soak', 'Non-Windows behavior and joint-system GA'],
  };
}

export function markdown(report) {
  return `# 三层语义收敛收益与恢复决策\n\n本报告由 agent 自动生成，测量候选 ${report.measurementCandidate.commit}。10 组发现均有明确边界的 resolved verdict，详见机器报告及 TF-0746 的逐项矩阵。\n\n${report.observedAfter.map(row => `- ${row.id}: ${row.value} ${row.unit}；method=${row.method}，证据 ${row.source}。`).join('\n')}\n\nM0 保留原始 dirty=${report.baseline.candidate.dirty} 的源码基线。其 MEM-1 是 5 个标签匹配，规划文本的 3 个位置属于不同计数范围；不将两者偷换或计算百分比。静态上限、结构计数与本地行为分别报告，未形成同 fixture 的 live-user 前后配对，因此用户收益、生产成本和美元节省均为 not-measured。\n\n冻结权重为 0.35 correctness + 0.25 user impact + 0.20 coverage + 0.10 cost efficiency + 0.10 evidence quality。可验证的修复/覆盖/证据维度均为 1，impact/cost 不可用；记分卡区间 ${report.score.interval.lower}..${report.score.interval.upper} 只表示缺失维度的上下界，不是收益百分比或置信区间。\n\n最终门禁累计 ${report.verificationCost.aggregateGateMs} ms，观察窗口 ${report.verificationCost.observedGateWindowMs} ms；前者包含并行执行的时长之和，不是开发墙钟耗时，也不含全部失败重跑/复核成本。\n\ndecision.status=keep-retired，runtime.memory.persist=false。默认值变更提案为空，应用为空，产品锁与发布状态未改变。Memory 是恢复前门禁，prompt 是显式 enforce/seal 验证，不外推为生产默认开启、live-provider 或 GA。\n\n复算：node scripts/semantic-convergence-benefit.mjs --verify。此报告不包含人工操作或真人数据证据。\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = buildBenefitReport();
  const target = resolve(root, prefix + 'tf-0747/report.json');
  const doc = resolve(root, 'docs/dev/semantic-convergence-benefit-20261104.md');
  if (process.argv.includes('--verify')) {
    assert.deepEqual(read(target), report, 'benefit report drift');
    assert.equal(readFileSync(doc, 'utf8'), markdown(report), 'benefit document drift');
    console.log(JSON.stringify({ passed: true, findings: report.findings.length, scoreInterval: report.score.interval }));
  } else {
    writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
    writeFileSync(doc, markdown(report));
    console.log(JSON.stringify({ wrote: target, findings: report.findings.length }));
  }
}
