// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertDeclarationOnly, buildPublicTaskInputs, buildTaskInputBindings, publicDeclarations, verifyTaskInputBindings } from '../../scripts/lib/rsi-task-inputs.mjs';
import { createBenefitPlan, buildBenefitRequest, validateBenefitPlan } from '../../scripts/lib/rsi-benefit-eval.mjs';
import { CODING_COLLECTOR, STRUCTURED_CODING_COLLECTOR, PUBLIC_CODING_COLLECTOR } from '../../scripts/lib/rsi-coding-protocol.mjs';

const root = process.cwd();
const preparedBindings = buildTaskInputBindings(root);
expect(preparedBindings.tasks).toHaveLength(24);
describe('RSI public task input boundary', () => {
  it('preserves an ambient literal constant as a type without retaining its initializer', () => {
    const declarations = publicDeclarations('export declare const ID = "public-id";', 'shared/contract.d.mts');
    expect(declarations).toContain('ID: "public-id"');
    expect(assertDeclarationOnly(declarations)).toBe(true);
    expect(declarations).not.toContain('= "public-id"');
  });
  it('supplies the absent G03 module interface through the real v3 request without implementation bodies', () => {
    const plan = createBenefitPlan(root, { codingCollector: true, collectorVersion: PUBLIC_CODING_COLLECTOR.version });
    const slot = plan.slots.find(slot => slot.caseId === 'tf-0291-g03')!;
    const input = JSON.parse(buildBenefitRequest(plan, slot).input as string);
    expect(input.publicContract.protocol).toBe('RsiCodingTaskInputs/v1');
    expect(input.publicContract.declarations[0].content).toContain('traceToEvalSample');
    expect(input.publicContract.declarations[0].content).toContain('RedactedFailureTrace');
    expect(input.publicContract.behavior).toContain('16 lowercase hexadecimal characters');
    expect(input.publicContract.behavior).toContain('missing-field');
    expect(input.baseFiles.find((file: {path: string}) => file.path === 'scripts/lib/trace-to-eval-sample.mjs').missing).toBe(true);
    for (const declaration of input.publicContract.declarations) expect(assertDeclarationOnly(declaration.content)).toBe(true);
    expect(input).not.toHaveProperty('oracle');
    expect(input).not.toHaveProperty('reference');
    expect(input).not.toHaveProperty('split');
  });
  it('covers both implementation and specification tasks with source-bound inputs', () => {
    const bindings = buildTaskInputBindings(root);
    expect(bindings.tasks).toHaveLength(24);
    expect(bindings.tasks.filter(task => task.kind === 'module-implementation')).toHaveLength(14);
    expect(bindings.tasks.filter(task => task.kind === 'specification-verification')).toHaveLength(10);
    for (const task of bindings.tasks) {
      const result = buildPublicTaskInputs(root, task.identity.id);
      expect(result.input.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(JSON.stringify(result.input, null, 2).length).toBeLessThanOrEqual(100000);
      expect(result.sources.every(source => /^[a-f0-9]{40}$/.test(source.revision))).toBe(true);
      if (task.kind === 'module-implementation') expect(result.input.publicContract.declarations.length).toBeGreaterThan(0);
    }
  });
  it('keeps both legacy request projections free of the prospective public contract', () => {
    for (const collector of [CODING_COLLECTOR, STRUCTURED_CODING_COLLECTOR]) {
      const plan = createBenefitPlan(root, { codingCollector: true, collectorVersion: collector.version });
      const input = JSON.parse(buildBenefitRequest(plan, plan.slots[0]).input as string);
      expect(Object.keys(input)).toEqual(['prompt', 'acceptanceCriteria', 'targetScope', 'responseSchema', 'baseFiles']);
      expect(input).not.toHaveProperty('publicContract');
    }
  });
  it('rejects changed frozen public declarations and source identities', () => {
    const bindings = buildTaskInputBindings(root);
    bindings.tasks[0].publicSources[0].declaration += '\nexport declare function fabricatedWinner(): true;\n';
    expect(() => verifyTaskInputBindings(root, bindings)).toThrow('public-task-input-bindings-drift');
    const changedSource = buildTaskInputBindings(root);
    changedSource.tasks[0].publicSources[0].sourceSha256 = '0'.repeat(64);
    expect(() => verifyTaskInputBindings(root, changedSource)).toThrow('public-task-input-bindings-drift');
  });
  it.each([
    'export function solve() { return true; }',
    'export const solution = {winner: true};',
    'console.log("side effect");',
    'import type { Answer } from "../../tests/unit/oracle.test.js"; export type Output = Answer;',
  ])('rejects executable or oracle-bearing declarations: %s', source => {
    expect(() => assertDeclarationOnly(source)).toThrow();
  });
  it('rejects missing public APIs, private source paths and compiler drift', () => {
    const missing = buildTaskInputBindings(root);
    missing.tasks[0].publicSources = [];
    expect(() => verifyTaskInputBindings(root, missing)).toThrow('public-task-input-bindings-drift');
    const privateSource = buildTaskInputBindings(root);
    privateSource.tasks[0].baseSources[0].path = 'tests/unit/hidden.test.ts';
    expect(() => verifyTaskInputBindings(root, privateSource)).toThrow('private-public-input-path');
    const compiler = buildTaskInputBindings(root);
    compiler.compilerVersion = 'unfrozen';
    expect(() => verifyTaskInputBindings(root, compiler)).toThrow('public-input-compiler-drift');
    const generated = buildTaskInputBindings(root);
    generated.tasks[0].baseSources[0].path = 'reports/previous-model-answer.js';
    expect(() => verifyTaskInputBindings(root, generated)).toThrow();
  });
  it('fails closed instead of truncating required input to a smaller budget', () => {
    expect(() => buildPublicTaskInputs(root, 'tf-0291-g03', { maxContextChars: 128 })).toThrow('required-public-input-over-budget');
    expect(() => buildPublicTaskInputs(root, 'tf-0290-g02', { maxContextFiles: 1 })).toThrow('required-base-input-over-budget');
  });
  it('validates v3 bindings and rejects a re-signed subject projection', () => {
    const plan = createBenefitPlan(root, { codingCollector: true, collectorVersion: PUBLIC_CODING_COLLECTOR.version });
    expect(validateBenefitPlan(plan, root)).toBe(true);
    plan.tasks[0].publicInput!.publicContract.declarations[0].content += '\nexport declare const fabricated: true;\n';
    expect(() => validateBenefitPlan(plan, root)).toThrow('frozen-tasks-drift');
  });
});
