#!/usr/bin/env node
/**
 * chain-audit 量化分级评估库
 * 将链路测试结果映射为统一分级（A/B/C/D/F）+ 可比较的量化分（0-100）。
 * 分级标准跨任务通用，便于历史对比和趋势追踪。
 */
export const GRADES = {
  A: { label: "健康", color: "green", min: 90, desc: "链路完全打通，指标达标" },
  B: { label: "可用", color: "blue", min: 75, desc: "链路打通，有轻微缺陷" },
  C: { label: "部分", color: "yellow", min: 60, desc: "链路部分可用，有阻断项" },
  D: { label: "受损", color: "orange", min: 40, desc: "链路严重受损" },
  F: { label: "断裂", color: "red", min: 0, desc: "链路完全断裂" },
};

/**
 * 根据一组布尔检查 + 数值指标计算分级与分数。
 * @param {object} params
 * @param {Record<string,boolean>} params.checks     命名检查项（true=通过）
 * @param {string[]} [params.criticalChecks]         关键检查名——失败直接判 F（链路断连语义）
 * @param {Record<string,{value:number,good:number,bad:number,warn?:number}>} params.metrics 数值指标
 * @returns {{grade:string, score:number, passedChecks:number, totalChecks:number, warnings:string[]}}
 */
export function grade({ checks = {}, criticalChecks = [], metrics = {} }) {
  const checkEntries = Object.entries(checks);
  const passedChecks = checkEntries.filter(([, v]) => v).length;
  const totalChecks = checkEntries.length;

  // 关键检查失败 → 直接 F（链路断连，不因其他指标稀释）
  const failedCritical = criticalChecks.filter((name) => checks[name] === false);
  if (failedCritical.length > 0) {
    return {
      grade: GRADES.F.label,
      score: 10,
      passedChecks,
      totalChecks,
      warnings: [`关键检查失败: ${failedCritical.join(", ")}`],
    };
  }

  const checkScore = totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 100;

  const warnings = [];
  let metricScore = 100;
  const metricParts = [];
  for (const [name, m] of Object.entries(metrics)) {
    if (m.value === undefined || m.value === null) { metricParts.push(100); continue; }
    // 线性映射：value >= good → 100; value <= bad → 0
    let part = 100;
    if (m.value < m.good) {
      part = Math.max(0, Math.min(100, ((m.value - m.bad) / (m.good - m.bad)) * 100));
    }
    metricParts.push(part);
    if (m.warn !== undefined && m.value >= m.warn) {
      warnings.push(`${name}=${m.value} (warn 阈值 ${m.warn})`);
    }
  }
  metricScore = metricParts.length > 0
    ? metricParts.reduce((a, b) => a + b, 0) / metricParts.length
    : 100;

  const score = Math.round(checkScore * 0.7 + metricScore * 0.3);
  const grade = Object.values(GRADES).find((g) => score >= g.min) ?? GRADES.F;
  return { grade: grade.label, score, passedChecks, totalChecks, warnings };
}

/** 汇总多个子任务 → 总分级。 */
export function aggregate(results) {
  if (!results.length) {
    return { grade: "not executed", score: null, taskCount: 0, passed: 0, failed: 0, breakdown: [] };
  }
  const scores = results.map((r) => r.score ?? 0);
  const total = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const grade = Object.values(GRADES).find((g) => total >= g.min) ?? GRADES.F;
  return {
    grade: grade.label,
    score: total,
    taskCount: results.length,
    passed: results.filter((r) => (r.score ?? 0) >= 75).length,
    failed: results.filter((r) => (r.score ?? 0) < 75).length,
    breakdown: results.map((r) => ({
      id: r.id,
      grade: r.grade,
      score: r.score,
      criticalFailed: (r.criticalFailed ?? []).length,
    })),
  };
}
