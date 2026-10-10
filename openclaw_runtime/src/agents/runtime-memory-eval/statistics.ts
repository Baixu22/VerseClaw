// Statistical significance module for runtime-memory evaluation.
// Pure functions, deterministic (mulberry32 fixed seed), no external dependencies.

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

export function variance(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  let total = 0;
  for (const v of values) {
    const d = v - m;
    total += d * d;
  }
  return total / values.length;
}

export function stdDev(values: readonly number[]): number {
  return Math.sqrt(variance(values));
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[rank];
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export type BootstrapCIResult = {
  mean: number;
  lower: number;
  upper: number;
  iterations: number;
  confidence: number;
};

const DEFAULT_BOOTSTRAP_ITERATIONS = 1000;
const DEFAULT_BOOTSTRAP_CONFIDENCE = 0.95;
const DEFAULT_BOOTSTRAP_SEED = 0x1a2b3c4d;

export function bootstrapConfidenceInterval(
  samples: readonly number[],
  options?: {
    iterations?: number;
    confidence?: number;
    seed?: number;
  },
): BootstrapCIResult {
  const iterations = options?.iterations ?? DEFAULT_BOOTSTRAP_ITERATIONS;
  const confidence = options?.confidence ?? DEFAULT_BOOTSTRAP_CONFIDENCE;
  const seed = options?.seed ?? DEFAULT_BOOTSTRAP_SEED;

  if (samples.length === 0) {
    return { mean: 0, lower: 0, upper: 0, iterations, confidence };
  }

  const sampleMean = mean(samples);
  if (samples.length === 1) {
    return { mean: sampleMean, lower: sampleMean, upper: sampleMean, iterations, confidence };
  }

  const rng = mulberry32(seed);
  const n = samples.length;
  const bootstraps: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i += 1) {
    let total = 0;
    for (let j = 0; j < n; j += 1) {
      const idx = Math.floor(rng() * n);
      total += samples[idx];
    }
    bootstraps[i] = total / n;
  }

  const alpha = 1 - confidence;
  const lower = percentile(bootstraps, alpha / 2);
  const upper = percentile(bootstraps, 1 - alpha / 2);

  return {
    mean: sampleMean,
    lower,
    upper,
    iterations,
    confidence,
  };
}

export type PairedTTestResult = {
  t: number;
  df: number;
  pValue: number;
  meanDiff: number;
  stdDevDiff: number;
  significant: boolean;
  alpha: number;
};

const DEFAULT_ALPHA = 0.05;

function sampleStdDev(values: readonly number[], m: number): number {
  if (values.length <= 1) return 0;
  let total = 0;
  for (const v of values) {
    const d = v - m;
    total += d * d;
  }
  return Math.sqrt(total / (values.length - 1));
}

// Two-sided critical t-values for alpha=0.05, df=1..30.
// For df > 30 we use the normal approximation (z = 1.959964).
function logGamma(x: number): number {
  const coefficients = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const value = x - 1;
  let sum = coefficients[0];
  const t = value + 7.5;
  for (let index = 1; index < coefficients.length; index += 1) {
    sum += coefficients[index] / (value + index);
  }
  return 0.5 * Math.log(2 * Math.PI) + (value + 0.5) * Math.log(t) - t + Math.log(sum);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (factor * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (factor * betaContinuedFraction(b, a, 1 - x)) / b;
}

function studentTTwoSidedPValue(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  const x = df / (df + t * t);
  return regularizedIncompleteBeta(df / 2, 0.5, x);
}

export function pairedTTest(
  baseline: readonly number[],
  treatment: readonly number[],
  options?: { alpha?: number },
): PairedTTestResult {
  const alpha = options?.alpha ?? DEFAULT_ALPHA;

  if (baseline.length === 0 || treatment.length === 0) {
    throw new Error("pairedTTest requires non-empty samples");
  }
  if (baseline.length !== treatment.length) {
    throw new Error(
      `pairedTTest requires equal-length samples (got baseline=${baseline.length}, treatment=${treatment.length})`,
    );
  }

  const n = baseline.length;
  const diffs = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    diffs[i] = treatment[i] - baseline[i];
  }

  const meanDiff = mean(diffs);
  // Sample stdDev (divide by n-1) — required for paired t-test.
  const stdDevDiff = sampleStdDev(diffs, meanDiff);
  const df = n - 1;

  if (stdDevDiff === 0) {
    return {
      t: meanDiff === 0 ? 0 : Number.POSITIVE_INFINITY,
      df,
      pValue: meanDiff === 0 ? 1 : 0,
      meanDiff,
      stdDevDiff,
      significant: meanDiff !== 0,
      alpha,
    };
  }

  const t = meanDiff / (stdDevDiff / Math.sqrt(n));
  const pValue = studentTTwoSidedPValue(t, df);

  return {
    t,
    df,
    pValue,
    meanDiff,
    stdDevDiff,
    significant: pValue < alpha,
    alpha,
  };
}

export function minimumSampleSize(
  effectSize?: number,
  alpha?: number,
  power?: number,
): number {
  const d = effectSize ?? 0.2;
  const a = alpha ?? 0.05;
  const p = power ?? 0.8;

  if (d <= 0) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(d)) return 1;

  // z_alpha/2 (two-sided) and z_beta (one-sided).
  // For alpha=0.05 two-sided: z_alpha/2 = 1.959964
  // For power=0.8: z_beta = 0.841621
  const zAlphaHalf = inverseNormalCdf(1 - a / 2);
  const zBeta = inverseNormalCdf(p);

  const n = Math.pow((zAlphaHalf + zBeta) / d, 2);
  return Math.ceil(n);
}

// Inverse standard normal CDF (probit) approximation.
function inverseNormalCdf(p: number): number {
  // Acklam's algorithm.
  const a = [
    -3.969683028665376e1,
    2.209460984245205e2,
    -2.759285104469687e2,
    1.38357751867269e2,
    -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1,
    1.615858368580409e2,
    -1.556989798598866e2,
    6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3,
    -3.223964580411365e-1,
    -2.400758277161838,
    -2.549732539343734,
    4.374664141464968,
    2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3,
    3.224671290700398e-1,
    2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let q: number;
  let x: number;

  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    const r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  return x;
}

export function cohensD(
  baseline: readonly number[],
  treatment: readonly number[],
): number {
  if (baseline.length === 0 || treatment.length === 0) return 0;

  const n1 = baseline.length;
  const n2 = treatment.length;
  const m1 = mean(baseline);
  const m2 = mean(treatment);

  // Sample variance (divide by n-1) — required for Cohen's d pooled std.
  const sampleVariance = (vals: readonly number[], m: number): number => {
    if (vals.length <= 1) return 0;
    let total = 0;
    for (const v of vals) {
      const d = v - m;
      total += d * d;
    }
    return total / (vals.length - 1);
  };

  const v1 = sampleVariance(baseline, m1);
  const v2 = sampleVariance(treatment, m2);

  const pooledVar = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
  const pooledStd = Math.sqrt(pooledVar);

  if (pooledStd === 0) return m2 - m1 === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (m2 - m1) / pooledStd;
}
