// @vitest-environment node
/**
 * FP-P0-06: config type / zod schema parity guard.
 *
 * Guards against the FP-P0-02 defect class: a runtime.* leaf that exists in
 * types.openclaw.ts (and is documented via schema.labels/schema.help) but is
 * rejected by the strict zod schema. Writing such a leaf does not "do nothing" —
 * config validation fails and the gateway child exits code=1, so the gateway
 * cannot start at all.
 *
 * Three directions are locked:
 *  1. type → schema: every leaf of RUNTIME_FEATURE_EXHAUSTIVE (compile-checked
 *     to mirror RuntimeFeatureConfig exactly) must be accepted by OpenClawSchema.
 *  2. schema → type: every leaf reachable by zod-schema introspection under
 *     `runtime` must exist in the exhaustive fixture (schema-has/type-missing).
 *  3. labels/help → schema: every documented "runtime.*" key must resolve to a
 *     node or leaf of the fixture tree (documented-but-unwritable = lying to ops).
 */
import { describe, expect, it } from 'vitest';
import { OpenClawSchema } from '../../openclaw_runtime/src/config/zod-schema';
import {
  RUNTIME_FEATURE_EXHAUSTIVE,
  SCHEMA_PARITY_INTENTIONAL_GAPS,
  listLeafPaths,
} from '../../openclaw_runtime/src/config/runtime-feature-leaves';
import { FIELD_LABELS } from '../../openclaw_runtime/src/config/schema.labels';
import { FIELD_HELP } from '../../openclaw_runtime/src/config/schema.help';

const intentionalGaps = new Set(SCHEMA_PARITY_INTENTIONAL_GAPS.map((gap) => gap.path));
const fixtureLeaves = listLeafPaths(RUNTIME_FEATURE_EXHAUSTIVE).map((path) => `runtime.${path}`);

/** All node prefixes (including leaves) of the fixture tree, "runtime."-prefixed. */
const fixtureNodes = new Set<string>(['runtime']);
for (const leaf of fixtureLeaves) {
  const parts = leaf.split('.');
  for (let i = 2; i <= parts.length; i += 1) {
    fixtureNodes.add(parts.slice(0, i).join('.'));
  }
}

function getAtPath(root: unknown, path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function buildNested(path: string[], value: unknown): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let cursor = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const next: Record<string, unknown> = {};
    cursor[path[i]] = next;
    cursor = next;
  }
  cursor[path[path.length - 1]] = value;
  return root;
}

/** Unwrap zod v4 wrapper types (optional/default/nullable/readonly) to the inner schema. */
function unwrapSchema(schema: unknown): unknown {
  let node = schema as { def?: { type?: string; innerType?: unknown } } | undefined;
  while (
    node?.def &&
    (node.def.type === 'optional' ||
      node.def.type === 'default' ||
      node.def.type === 'nullable' ||
      node.def.type === 'readonly') &&
    node.def.innerType
  ) {
    node = node.def.innerType as typeof node;
  }
  return node;
}

function schemaLeafPaths(schema: unknown, prefix: string): string[] {
  const unwrapped = unwrapSchema(schema) as {
    def?: { type?: string };
    shape?: Record<string, unknown>;
  };
  if (unwrapped?.def?.type === 'object' && unwrapped.shape) {
    return Object.entries(unwrapped.shape).flatMap(([key, child]) =>
      schemaLeafPaths(child, `${prefix}.${key}`),
    );
  }
  return [prefix];
}

describe('FP-P0-06 config type / zod schema parity', () => {
  it('sanity: the exhaustive fixture is non-trivial', () => {
    expect(fixtureLeaves.length).toBeGreaterThanOrEqual(60);
  });

  // Direction 1 — type has / schema must accept. This is the guard that would have
  // caught the runtime.contextEnhancement gateway-killer before it shipped.
  it.each(fixtureLeaves)('typed leaf is accepted by the strict schema: %s', (leaf) => {
    if (intentionalGaps.has(leaf)) return;
    const path = leaf.split('.').slice(1);
    const value = getAtPath(RUNTIME_FEATURE_EXHAUSTIVE, path);
    const parsed = OpenClawSchema.safeParse({ runtime: buildNested(path, value) });
    expect(
      parsed.success,
      `type-declared config leaf "${leaf}" (sample ${JSON.stringify(value)}) is rejected by ` +
        `zod-schema.ts — writing it would make the gateway exit code=1 on start. ` +
        `Issues: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`,
    ).toBe(true);
  });

  // Direction 2 — schema has / type must have (schema drift the other way).
  it('every schema-accepted runtime leaf exists in the compile-checked type fixture', () => {
    const runtimeSchema = (OpenClawSchema as unknown as { shape: Record<string, unknown> }).shape
      .runtime;
    const schemaLeaves = schemaLeafPaths(runtimeSchema, 'runtime');
    expect(schemaLeaves.length).toBeGreaterThanOrEqual(60);
    const unknownToType = schemaLeaves.filter((leaf) => !fixtureNodes.has(leaf));
    expect(
      unknownToType,
      'zod-schema.ts accepts runtime leaves that RuntimeFeatureConfig does not declare',
    ).toEqual([]);
  });

  // Direction 3 — documented (labels/help) implies writable.
  for (const [mapName, map] of [
    ['schema.labels.ts', FIELD_LABELS],
    ['schema.help.ts', FIELD_HELP],
  ] as const) {
    it(`every runtime.* key documented in ${mapName} is a real, schema-accepted config node`, () => {
      const runtimeKeys = Object.keys(map).filter((key) => key.startsWith('runtime.'));
      expect(runtimeKeys.length).toBeGreaterThanOrEqual(50);
      const phantom = runtimeKeys.filter((key) => !fixtureNodes.has(key));
      expect(
        phantom,
        `${mapName} documents runtime keys that do not exist in RuntimeFeatureConfig — ` +
          'operators following the UI docs would write config the gateway rejects',
      ).toEqual([]);
    });
  }

  // Regression: the exact FP-P0-02 defect stays covered even if fixtures change.
  it('regression: runtime.contextEnhancement.killSwitch is schema-accepted', () => {
    const parsed = OpenClawSchema.safeParse({
      runtime: { contextEnhancement: { killSwitch: true } },
    });
    expect(parsed.success).toBe(true);
  });

  // Hard lock: the guard must not be satisfiable by loosening strictness.
  it('the runtime schema is still strict (unknown leaves are rejected)', () => {
    const parsed = OpenClawSchema.safeParse({
      runtime: { contextEnhancement: { killSwitch: true, bogusLeaf: true } },
    });
    expect(parsed.success).toBe(false);
    const parsedTop = OpenClawSchema.safeParse({ runtime: { notARealFeature: {} } });
    expect(parsedTop.success).toBe(false);
  });

  it('every intentional gap entry has a non-empty reason', () => {
    for (const gap of SCHEMA_PARITY_INTENTIONAL_GAPS) {
      expect(gap.reason.trim().length).toBeGreaterThan(0);
    }
  });
});
