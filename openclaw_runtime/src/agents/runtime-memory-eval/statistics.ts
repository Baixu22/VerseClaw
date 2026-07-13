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
const T_CRITICAL_05: ReadonlyArray<number> = [
  12.70620573644963, // df=1
  4.302652729949265, // df=2
  3.1824463052838063, // df=3
  2.776445105197799, // df=4
  2.57058183661474, // df=5
  2.4469118487916806, // df=6
  2.3646242515927853, // df=7
  2.3060041352042697, // df=8
  2.262157162798205, // df=9
  2.2281388519649385, // df=10
  2.2009851600819488, // df=11
  2.178812829667226, // df=12
  2.1603686564610127, // df=13
  2.144786687917802, // df=14
  2.1314495455597746, // df=15
  2.119905299221253, // df=16
  2.1098155778331806, // df=17
  2.100922040240598, // df=18
  2.0930240544083025, // df=19
  2.0859634472658626, // df=20
  2.079613844727619, // df=21
  2.073873067901116, // df=22
  2.0686576104190437, // df=23
  2.0638985616280205, // df=24
  2.0595385527532937, // df=25
  2.0555294386428713, // df=26
  2.0518305164807846, // df=27
  2.048407141795946, // df=28
  2.0452296424706833, // df=29
  2.0422724563012373, // df=30
];

const Z_05_TWO_SIDED = 1.959963984540054;

function tCriticalTwoSidedAlpha05(df: number): number {
  if (df <= 0) return Number.POSITIVE_INFINITY;
  if (df >= 1 && df <= 30) return T_CRITICAL_05[df - 1];
  // df > 30: normal approximation
  return Z_05_TWO_SIDED;
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

  // p-value via critical t comparison (two-sided, alpha=0.05 table only).
  // For general alpha we use the normal approximation when df > 30.
  let pValue: number;
  if (alpha === DEFAULT_ALPHA) {
    const critical = tCriticalTwoSidedAlpha05(df);
    if (Math.abs(t) > critical) {
      pValue = 0.049;
    } else {
      pValue = 0.051;
    }
  } else {
    // Normal approximation fallback for non-default alpha.
    const z = Math.abs(t);
    pValue = 2 * (1 - normalCdf(z));
  }

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

// Standard normal CDF approximation (Abramowitz & Stegun 7.1.26).
function normalCdf(x: number): number {
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const phi =
    c * Math.exp(-absX * absX / 2) * (b1 * t + b2 * t * t + b3 * t * t * t + b4 * t * t * t * t + b5 * t * t * t * t * t);
  return x > 0 ? 1 - phi : phi;
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
