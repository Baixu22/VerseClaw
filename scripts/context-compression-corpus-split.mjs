#!/usr/bin/env node
/**
 * Phase 2 corpus trisection (TF-0074 v8 optimization).
 *
 * One-shot, deterministic, frozen after recording:
 *   regression set  = existing production manifest (30 samples, never optimized)
 *   optimization set = first 40 eligible sessions by sha256(basename) order
 *   frozen holdout   = next 20 eligible sessions (final evaluation ONLY; the
 *                      optimization loop must not inspect per-sample holdout
 *                      results before the terminal round)
 *
 * Eligibility (calibrated against the real corpus on 2026-08-25): size >= 20KB
 * and >= 12 parseable message entries, excluding trajectory flight recorders
 * (.trajectory.jsonl) and every transcript already used by the regression
 * manifest. DEVIATION from the v8 plan (40+20 at >=50KB/>=200 entries): only
 * 43 sessions satisfy any reasonable task-shaped filter, so the split scales
 * to the available pool (optimization = pool - 15, holdout = 15).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function countMessageEntries(file) {
  const raw = readFileSync(file, 'utf8');
  let count = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed?.type === 'message') count += 1;
    } catch {
      // ignore malformed lines
    }
  }
  return count;
}

function buildManifestRow({ id, basename, file, turn = 200 }) {
  const stats = statSync(file);
  return {
    key: sha256(basename),
    id,
    source: 'real',
    cohort: {
      turn,
      pressure: '0.75',
      provider: 'openclaw',
      splitTurn: 'continuous',
      previousSummary: 'without-previous-summary',
      fileHunk: 'without-file-hunk',
    },
    transcript: {
      fileHash: sha256(readFileSync(file)),
      basename,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    },
    evidenceMessageIds: [],
  };
}

function main() {
  const sessionRoot = resolve(argValue('--sessions', 'C:/Users/27933/.openclaw/agents/main/sessions'));
  const manifestPath = resolve(argValue('--manifest', 'reports/context-compression/production-manifest-30.json'));
  const outDir = resolve(argValue('--out-dir', 'reports/context-compression'));
  const minBytes = Number(argValue('--min-bytes', String(20 * 1024)));
  const minEntries = Number(argValue('--min-entries', '12'));

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const regressionBasenames = new Set((manifest.samples ?? []).map((sample) => sample.transcript.basename));

  const candidates = [];
  for (const name of readdirSync(sessionRoot)) {
    if (!name.endsWith('.jsonl') || name.endsWith('.trajectory.jsonl') || name.includes('.deleted.') || name.includes('.reset.')) continue;
    if (regressionBasenames.has(name)) continue;
    const file = join(sessionRoot, name);
    const size = statSync(file).size;
    if (size < minBytes) continue;
    const entryCount = countMessageEntries(file);
    if (entryCount < minEntries) continue;
    candidates.push({ basename: name, file, size, entryCount, sha256: sha256(name) });
  }
  candidates.sort((left, right) => left.sha256.localeCompare(right.sha256));
  const pool = candidates.length;
  const holdoutCount = Number(argValue('--holdout-count', pool >= 40 ? '15' : String(Math.max(5, Math.floor(pool * 0.35)))));
  const optimizationCount = Number(argValue('--optimization-count', String(Math.max(0, pool - holdoutCount))));
  if (candidates.length < optimizationCount + holdoutCount) {
    throw new Error(`not enough eligible sessions: need ${optimizationCount + holdoutCount}, found ${candidates.length}`);
  }

  const optimization = candidates.slice(0, optimizationCount).map((item, index) => ({ ...item, id: `O${index + 1}` }));
  const holdout = candidates.slice(optimizationCount, optimizationCount + holdoutCount).map((item, index) => ({ ...item, id: `H${index + 1}` }));

  // Mutual-exclusion assertion (regression / optimization / holdout).
  const seen = new Set(regressionBasenames);
  for (const item of [...optimization, ...holdout]) {
    if (seen.has(item.basename)) throw new Error(`trisection overlap detected: ${item.basename}`);
    seen.add(item.basename);
  }

  const trisection = {
    schema: 'corpus-trisection/v1',
    generatedAt: new Date().toISOString(),
    sessionRoot,
    filters: { minBytes, minEntries, excludedRegression: regressionBasenames.size },
    ordering: 'sha256(basename) ascending; deterministic and frozen',
    candidateCount: candidates.length,
    sets: {
      regression: {
        count: regressionBasenames.size,
        manifest: 'reports/context-compression/production-manifest-30.json',
        policy: 'regression-only; never optimized against',
      },
      optimization: {
        count: optimization.length,
        policy: 'iterable by the optimization loop',
        samples: optimization.map(({ id, basename, sha256, size, entryCount }) => ({ id, basename, sha256, size, entryCount })),
      },
      holdout: {
        count: holdout.length,
        policy: 'FROZEN: terminal evaluation only; per-sample inspection forbidden before the final round',
        samples: holdout.map(({ id, basename, sha256, size, entryCount }) => ({ id, basename, sha256, size, entryCount })),
      },
    },
  };
  writeFileSync(resolve(outDir, 'corpus-trisection-v1.json'), `${JSON.stringify(trisection, null, 2)}\n`, 'utf8');

  const writeManifestAndMeta = (samples, manifestFile, metaFile) => {
    const manifestPayload = {
      schema: 'handoff-corpus-manifest/v1',
      generatedAt: trisection.generatedAt,
      trisectionRef: 'reports/context-compression/corpus-trisection-v1.json',
      requestedSampleCount: samples.length,
      samples: samples.map((item) => buildManifestRow({ id: item.id, basename: item.basename, file: item.file })),
    };
    writeFileSync(resolve(outDir, manifestFile), `${JSON.stringify(manifestPayload, null, 2)}\n`, 'utf8');
    const metaPayload = {
      schema: 'handoff-corpus-meta/v1',
      generatedAt: trisection.generatedAt,
      entries: samples.map((item) => ({ sampleId: item.id, file: item.file, basename: item.basename })),
    };
    writeFileSync(resolve(outDir, metaFile), `${JSON.stringify(metaPayload, null, 2)}\n`, 'utf8');
  };
  writeManifestAndMeta(optimization, 'optimization-manifest.json', 'optimization-meta.json');
  writeManifestAndMeta(holdout, 'holdout-manifest.json', 'holdout-meta.json');

  console.log(JSON.stringify({
    candidateCount: candidates.length,
    optimization: optimization.length,
    holdout: holdout.length,
    files: ['corpus-trisection-v1.json', 'optimization-manifest.json', 'optimization-meta.json', 'holdout-manifest.json', 'holdout-meta.json'].map((name) => resolve(outDir, name)),
  }, null, 2));
}

main();