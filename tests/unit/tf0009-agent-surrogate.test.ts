// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  validateTf0009AgentSurrogateCharter,
  validateTf0009AgentSurrogateReport,
} from '../../scripts/lib/tf0009-agent-surrogate.mjs';

const root = process.cwd();

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as Record<string, unknown>;
}

describe('TF-0009 agent-surrogate evidence tier', () => {
  const charter = readJson('artifacts/first-product-preview/TF-0009/agent-surrogate-charter.json');
  const report = readJson('artifacts/first-product-preview/TF-0009/agent-surrogate-report.json');

  it('keeps the charter bounded below human/live/product authority', () => {
    expect(validateTf0009AgentSurrogateCharter(charter)).toEqual({ ok: true, errors: [] });
  });

  it('records 10 agent runs per profile while human counts remain zero', () => {
    expect(validateTf0009AgentSurrogateReport(report)).toEqual({ ok: true, errors: [] });
  });

  it('fails closed if an agent report is relabeled as human or done', () => {
    const relabeled = structuredClone(report) as {
      humanEquivalent: boolean;
      taskForest: { canMarkDone: boolean };
    };
    relabeled.humanEquivalent = true;
    relabeled.taskForest.canMarkDone = true;
    const validation = validateTf0009AgentSurrogateReport(relabeled);
    expect(validation.ok).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([
      'report must keep humanEquivalent=false',
      'report must prohibit done',
    ]));
  });
});

