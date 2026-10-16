/**
 * Electron source-map resolution (TF-0030).
 *
 * Packed / minified renderer stacks → original file:line via local maps.
 * Searches common Electron layouts; never guesses a line when the map is missing.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import type { SourceMapResolver } from '../mcp/explain-error.ts';
import type { StackFrame } from '../contracts/index.ts';

export type ElectronMapSearchOptions = {
  /** App root containing resources/ or app.asar */
  appRoot?: string;
  /** Extra directories (renderer dist, unpacked asar, public). */
  searchDirs?: string[];
  /** Explicit map files. */
  mapPaths?: string[];
};

const DEFAULT_SUBDIRS = [
  'resources',
  'resources/app.asar.unpacked',
  'resources/app',
  'dist',
  'renderer',
  'renderer/dist',
  'public',
  'assets',
];

/**
 * Collect candidate `.map` files under Electron-ish layouts.
 */
export async function discoverElectronSourceMaps(
  options: ElectronMapSearchOptions = {},
): Promise<string[]> {
  const roots: string[] = [];
  if (options.appRoot) roots.push(options.appRoot);
  for (const dir of options.searchDirs ?? []) roots.push(dir);

  const found = new Set<string>(options.mapPaths ?? []);
  const visitDirs: string[] = [];

  for (const root of roots) {
    visitDirs.push(root);
    for (const sub of DEFAULT_SUBDIRS) {
      visitDirs.push(join(root, sub));
    }
  }

  for (const dir of visitDirs) {
    try {
      const info = await stat(dir);
      if (!info.isDirectory()) continue;
      const names = await readdir(dir);
      for (const name of names) {
        if (name.endsWith('.map')) found.add(join(dir, name));
        // one-level nested assets/
        if (name === 'assets' || name === 'dist' || name === 'renderer') {
          try {
            const nested = await readdir(join(dir, name));
            for (const n of nested) {
              if (n.endsWith('.map')) found.add(join(dir, name, n));
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore missing dirs */
    }
  }

  return [...found];
}

type Loaded = { map: TraceMap; path: string; sources: Map<string, string> };

async function loadMaps(paths: readonly string[]): Promise<Map<string, Loaded>> {
  const out = new Map<string, Loaded>();
  for (const path of paths) {
    try {
      const raw = await readFile(path, 'utf8');
      const json = JSON.parse(raw) as {
        sources?: string[];
        sourcesContent?: (string | null)[];
        mappings?: string;
      };
      if (!json.mappings) continue;
      const map = new TraceMap(json as never);
      const sources = new Map<string, string>();
      (json.sources ?? []).forEach((source, index) => {
        const content = json.sourcesContent?.[index];
        if (source && typeof content === 'string') sources.set(source, content);
      });
      out.set(basename(path).replace(/\.js\.map$/u, '.js').replace(/\.map$/u, ''), {
        map,
        path,
        sources,
      });
      out.set(basename(path), { map, path, sources });
    } catch {
      /* skip unreadable maps */
    }
  }
  return out;
}

function basenameFromUrl(url: string): string {
  const noQuery = url.split(/[?#]/u)[0] ?? url;
  const parts = noQuery.split(/[\\/]/u);
  return parts[parts.length - 1] || noQuery;
}

/**
 * SourceMapResolver compatible with explain_error.
 * Explicit failure when no map — never invents line numbers.
 */
export function createElectronSourceMapResolver(
  options: ElectronMapSearchOptions = {},
): SourceMapResolver {
  let cache: Map<string, Loaded> | null = null;

  return async (frame: StackFrame) => {
    const url = frame.url ?? '';
    if (!url || frame.line == null) {
      return { ...frame, mapped: false, reason: 'frame missing url/line' };
    }
    if (!cache) {
      const paths = await discoverElectronSourceMaps(options);
      cache = await loadMaps(paths);
    }
    const base = basenameFromUrl(url);
    const entry =
      cache.get(base) ??
      cache.get(base.replace(/\.js$/u, '.js.map')) ??
      [...cache.values()][0];
    if (!entry) {
      return {
        ...frame,
        mapped: false,
        reason:
          'electron source map not found (place <script>.js.map beside the renderer bundle or pass mapPaths)',
      };
    }
    const pos = originalPositionFor(entry.map, {
      line: frame.line,
      column: Math.max(0, (frame.column ?? 1) - 1),
    });
    if (!pos.source || pos.line == null) {
      return {
        ...frame,
        mapped: false,
        reason: 'electron source map did not resolve this generated position',
      };
    }
    const clean = pos.source.replace(/^spec:/u, '').replace(/^\.\//u, '');
    const text =
      entry.sources.get(pos.source) ??
      entry.sources.get(clean) ??
      entry.sources.get(basenameFromUrl(clean)) ??
      '';
    const snippetLine = text.split('\n')[pos.line - 1]?.trim();
    return {
      ...frame,
      mapped: true,
      source: clean,
      originalLine: pos.line,
      originalColumn: (pos.column ?? 0) + 1,
      name: pos.name ?? frame.functionName,
      snippet: snippetLine ? `L${pos.line}: ${snippetLine}` : undefined,
    };
  };
}
