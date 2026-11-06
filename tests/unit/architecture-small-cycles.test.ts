// @vitest-environment node
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { collectStronglyConnectedComponents } from '../../openclaw_runtime/scripts/lib/import-cycle-graph';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workspaceApi = 'electron/services/workspaces-api.ts';
const sandboxApi = 'electron/services/sandbox-api.ts';
const sync = 'electron/services/workspace-runtime-sync.ts';
const sandboxState = 'electron/services/sandbox-state.ts';
const factory = 'openclaw_runtime/src/agents/tools/context-agent-tools.ts';
const surface = 'openclaw_runtime/src/agents/tools/context-view-tool-surface.ts';
const files = [workspaceApi, sandboxApi, sync, sandboxState, factory, surface];

function scopedValueGraph() {
  return new Map(files.map((file) => {
    const source = ts.createSourceFile(file, readFileSync(resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const edges: string[] = [];
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(node)) {
        if (node.importClause?.isTypeOnly) continue;
        const names = node.importClause?.namedBindings;
        if (!node.importClause?.name && names && ts.isNamedImports(names) && names.elements.every((entry) => entry.isTypeOnly)) continue;
      } else {
        if (node.isTypeOnly) continue;
        const names = node.exportClause;
        if (names && ts.isNamedExports(names) && names.elements.every((entry) => entry.isTypeOnly)) continue;
      }
      const target = posix.normalize(posix.join(posix.dirname(file), node.moduleSpecifier.text));
      const match = files.find((candidate) => candidate === target || candidate === `${target}.ts` || candidate === target.replace(/\.js$/, '.ts'));
      if (match) edges.push(match);
    }
    return [file, edges] as const;
  }));
}

describe('architecture small-cycle boundaries', () => {
  it('keeps API state and executable tools above their shared leaves', () => {
    const graph = scopedValueGraph();
    expect(graph.get(workspaceApi)).toContain(sync);
    expect(graph.get(sync)).toEqual([sandboxState]);
    expect(graph.get(sandboxState)).toEqual([]);
    expect(graph.get(factory)).toContain(surface);
    expect(graph.get(surface)).toEqual([]);
    expect(collectStronglyConnectedComponents(graph)).toEqual([]);
  });

  it.each([
    [sync, workspaceApi],
    [sync, sandboxApi],
    [sandboxState, sandboxApi],
    [surface, factory],
  ])('detects the forbidden reverse value edge %s -> %s', (from, to) => {
    const graph = scopedValueGraph();
    graph.get(from)!.push(to);
    expect(collectStronglyConnectedComponents(graph).some((component) => component.includes(from) && component.includes(to))).toBe(true);
  });
});
