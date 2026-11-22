import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { assertNoSymlinkParentsSync } from "@openclaw/fs-safe/advanced";
import type {
  RelationshipExpansionV1,
  RelationshipIntent,
} from "../../../../../shared/knowledge/code-task-context.js";
import {
  readRegularFileSync,
  root as safeRoot,
  statRegularFileSync,
} from "../../../infra/fs-safe.js";
import {
  digestOwnerReadContent,
  type SourceRefV2,
} from "../../../runtime-core/knowledge-owner-read.js";
import type { ContextSnippet, GraphEdge, SymbolNode } from "../../fact-types.js";
import type { FactStore } from "../../factstore/store.js";

const HARD_MAX_NODES = 32;
const HARD_MAX_EDGES = 128;
const MAX_SCANNED_EDGES = 512;
const MAX_FILE_BYTES = 512 * 1024;
type PinnedFile = { text: string; ast: ts.SourceFile; source: SourceRefV2; symbols: SymbolNode[] };

function inside(root: string, absolute: string): string | undefined {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  return relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative)
    ? relative
    : undefined;
}
function rootIdentity(root: string): string {
  const real = realpathSync(root),
    stat = statSync(real);
  return JSON.stringify([real, stat.dev, stat.ino, stat.birthtimeMs]);
}
function repositoryRevision(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "content-addressed";
  }
}

/** Recheck endpoint bytes after the last asynchronous owner check. */
export function revalidateCodeRelationships(input: {
  store: FactStore;
  repoRoot: string;
  expansion: RelationshipExpansionV1;
}): boolean {
  const { expansion } = input;
  if (!expansion.sources.length) return true;
  const rejected: RelationshipExpansionV1["rejected"] = [];
  try {
    const repoRoot = path.resolve(input.repoRoot);
    const rootReal = realpathSync(repoRoot);
    const identity = rootIdentity(repoRoot);
    const namespaceId = `code:${digestOwnerReadContent(rootReal).slice(7)}`;
    const policyEpoch = digestOwnerReadContent(JSON.stringify([identity, namespaceId]));
    const revision = repositoryRevision(repoRoot);
    const project = input.store.getProjectByRoot(repoRoot);
    if (!project || revision !== expansion.repoRevision) throw new Error("code_owner_changed");
    for (const source of expansion.sources) {
      try {
        const filePath = path.resolve(rootReal, source.subjectId);
        if (
          path.isAbsolute(source.subjectId) ||
          source.subjectId.includes("\\") ||
          !inside(rootReal, filePath)
        )
          throw new Error("outside_workspace");
        if (
          source.domain !== "code" ||
          source.authorityId !== project.projectId ||
          source.namespaceId !== namespaceId ||
          source.policyEpoch !== policyEpoch
        )
          throw new Error("code_owner_changed");
        const matchesRecord = (record: ReturnType<FactStore["getFileRecord"]>) =>
          record?.status === "fresh" &&
          record.file.projectId === project.projectId &&
          record.file.contentHash === record.provenance.producedHash &&
          source.sourceDigest === `sha256:${record.provenance.producedHash}` &&
          source.revision === `${revision}:${record.generation}:${record.provenance.producedHash}`;
        if (!matchesRecord(input.store.getFileRecord(repoRoot, source.subjectId)))
          throw new Error("stale_edge");
        const parents = {
          rootDir: rootReal,
          targetPath: path.dirname(filePath),
          allowMissing: false,
          requireDirectories: true,
          allowRootChildSymlink: false,
        };
        assertNoSymlinkParentsSync(parents);
        const before = statRegularFileSync(filePath);
        if (before.missing || before.stat.nlink > 1) throw new Error("unsafe_code_file");
        const bytes = readRegularFileSync({ filePath, maxBytes: MAX_FILE_BYTES });
        assertNoSymlinkParentsSync(parents);
        const after = statRegularFileSync(filePath);
        if (
          after.missing ||
          bytes.stat.nlink > 1 ||
          after.stat.nlink > 1 ||
          after.stat.dev !== bytes.stat.dev ||
          after.stat.ino !== bytes.stat.ino
        )
          throw new Error("unsafe_code_file");
        if (
          digestOwnerReadContent(bytes.buffer) !== source.sourceDigest ||
          !matchesRecord(input.store.getFileRecord(repoRoot, source.subjectId))
        )
          throw new Error("stale_edge");
      } catch (error) {
        rejected.push({
          filePath: source.subjectId,
          reason: error instanceof Error ? error.message : "code_owner_denied",
        });
      }
    }
    if (rootIdentity(repoRoot) !== identity) throw new Error("workspace_changed");
  } catch (error) {
    rejected.push({
      filePath: "",
      reason: error instanceof Error ? error.message : "code_owner_unavailable",
    });
  }
  if (!rejected.length) return true;
  expansion.status = "unavailable";
  expansion.sources = [];
  expansion.edges = [];
  expansion.rejected = [...rejected, ...expansion.rejected].slice(0, HARD_MAX_EDGES);
  return false;
}

/** FactStore edges discover candidates; current filesystem and owner checks admit every endpoint. */
export async function expandCodeRelationships(input: {
  store: FactStore;
  repoRoot: string;
  seeds: string[];
  intent: RelationshipIntent;
  depth?: number;
  maxNodes?: number;
  budgetChars?: number;
  signal?: AbortSignal;
  assertCurrent?: (filePath: string) => void | Promise<void>;
}): Promise<{
  expansion: RelationshipExpansionV1;
  snippets: Array<ContextSnippet & { sourceRef: SourceRefV2 }>;
}> {
  const maxDepth = Math.min(2, Math.max(1, Math.floor(input.depth || 1)));
  const maxNodes = Math.min(
    HARD_MAX_NODES,
    Math.max(1, Math.floor(input.maxNodes || HARD_MAX_NODES)),
  );
  const expansion: RelationshipExpansionV1 = {
    schema: "RelationshipExpansion/v1",
    status: "complete",
    repoRevision: "",
    maxDepth,
    maxNodes,
    sources: [],
    edges: [],
    rejected: [],
    truncated: false,
  };
  const result = () => ({
    expansion,
    snippets: [] as Array<ContextSnippet & { sourceRef: SourceRefV2 }>,
  });
  if (input.intent === "lookup") {
    expansion.status = "disabled";
    return result();
  }
  const rejected = new Set<string>();
  const reject = (filePath: string, reason: string) => {
    const key = `${filePath}\0${reason}`;
    if (!rejected.has(key) && expansion.rejected.length < HARD_MAX_EDGES)
      expansion.rejected.push({ filePath, reason });
    rejected.add(key);
  };
  try {
    const repoRoot = path.resolve(input.repoRoot),
      identity = rootIdentity(repoRoot);
    const reader = await safeRoot(repoRoot, {
      hardlinks: "reject",
      symlinks: "reject",
      maxBytes: MAX_FILE_BYTES,
    });
    const project = input.store.getProjectByRoot(repoRoot);
    if (!project) {
      expansion.status = "unavailable";
      reject("", "missing_code_facts");
      return result();
    }
    expansion.repoRevision = repositoryRevision(repoRoot);
    const namespaceId = `code:${digestOwnerReadContent(reader.rootReal).slice(7)}`;
    const files = new Map<string, PinnedFile>(),
      denied = new Set<string>();
    const check = async (filePath: string) => {
      input.signal?.throwIfAborted();
      await input.assertCurrent?.(filePath);
      if (rootIdentity(repoRoot) !== identity) throw new Error("workspace_changed");
    };
    const read = async (filePath: string, final = false): Promise<PinnedFile | undefined> => {
      if (denied.has(filePath)) return undefined;
      try {
        await check(filePath);
        if (
          !inside(repoRoot, path.resolve(repoRoot, filePath)) ||
          path.isAbsolute(filePath) ||
          filePath.includes("\\")
        )
          throw new Error("outside_workspace");
        if (!files.has(filePath) && files.size >= maxNodes) {
          expansion.truncated = true;
          throw new Error("node_limit");
        }
        const record = input.store.getFileRecord(repoRoot, filePath);
        if (!record || record.file.projectId !== project.projectId)
          throw new Error("missing_code_facts");
        if (record.status !== "fresh" || record.file.contentHash !== record.provenance.producedHash)
          throw new Error("stale_edge");
        const bytes = await reader.read(filePath);
        await check(filePath);
        const sourceDigest = digestOwnerReadContent(bytes.buffer);
        if (sourceDigest !== `sha256:${record.provenance.producedHash}`)
          throw new Error("stale_edge");
        const previous = files.get(filePath);
        if (
          previous &&
          (previous.source.sourceDigest !== sourceDigest ||
            previous.source.revision !==
              `${expansion.repoRevision}:${record.generation}:${record.provenance.producedHash}`)
        )
          throw new Error("stale_edge");
        if (final && previous) return previous;
        const text = new TextDecoder("utf8", { fatal: true, ignoreBOM: true }).decode(bytes.buffer);
        const pinned = previous ?? {
          text,
          ast: ts.createSourceFile(
            path.resolve(repoRoot, filePath),
            text,
            ts.ScriptTarget.Latest,
            true,
          ),
          source: {
            schema: "SourceRef/v2" as const,
            domain: "code" as const,
            authorityId: project.projectId,
            namespaceId,
            subjectId: filePath,
            revision: `${expansion.repoRevision}:${record.generation}:${record.provenance.producedHash}`,
            sourceDigest,
            policyEpoch: digestOwnerReadContent(JSON.stringify([identity, namespaceId])),
          },
          symbols: input.store.getSymbolsByFile(repoRoot, filePath),
        };
        files.set(filePath, pinned);
        return pinned;
      } catch (error) {
        denied.add(filePath);
        reject(filePath, error instanceof Error ? error.message : "code_owner_denied");
        return undefined;
      }
    };
    const resolveModule = (sourceFile: string, specifier: string): string | undefined => {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;
      if (!inside(repoRoot, path.resolve(repoRoot, path.dirname(sourceFile), specifier)))
        return undefined;
      const resolved = ts.resolveModuleName(
        specifier,
        path.resolve(repoRoot, sourceFile),
        {
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          module: ts.ModuleKind.NodeNext,
          allowJs: true,
        },
        {
          fileExists: (absolute) => {
            const rel = inside(repoRoot, absolute);
            return Boolean(rel && input.store.getFileRecord(repoRoot, rel));
          },
          readFile: () => undefined,
        },
      ).resolvedModule?.resolvedFileName;
      return resolved ? inside(repoRoot, resolved) : undefined;
    };
    let program: ts.Program | undefined,
      programSize = -1;
    const checker = () => {
      if (!program || programSize !== files.size) {
        const options: ts.CompilerOptions = {
          noLib: true,
          noEmit: true,
          allowJs: true,
          checkJs: true,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          module: ts.ModuleKind.NodeNext,
        };
        const host: ts.CompilerHost = {
          ...ts.createCompilerHost(options),
          getCurrentDirectory: () => repoRoot,
          fileExists: (absolute) => Boolean(files.get(inside(repoRoot, absolute) ?? "")),
          readFile: (absolute) => files.get(inside(repoRoot, absolute) ?? "")?.text,
          getSourceFile: (absolute) => files.get(inside(repoRoot, absolute) ?? "")?.ast,
          writeFile: () => {},
          resolveModuleNames: (names, containing) =>
            names.map((name) => {
              const target = resolveModule(inside(repoRoot, containing) ?? "", name);
              return target && files.has(target)
                ? { resolvedFileName: path.resolve(repoRoot, target) }
                : undefined;
            }),
        };
        program = ts.createProgram(
          [...files.keys()].map((file) => path.resolve(repoRoot, file)),
          options,
          host,
        );
        programSize = files.size;
      }
      return program.getTypeChecker();
    };
    const resolveEdge = async (edge: GraphEdge, sourceFile: string) => {
      const source = await read(sourceFile);
      if (!source) return undefined;
      const sourceSymbol = source.symbols.find((symbol) => symbol.id === edge.sourceId);
      if (
        !sourceSymbol ||
        edge.projectId !== project.projectId ||
        edge.metadata?.sourceFile !== sourceFile
      ) {
        reject(sourceFile, "invalid_edge_owner");
        return undefined;
      }
      let targetFile: string | undefined, targetSymbol: SymbolNode | undefined;
      const line = typeof edge.metadata?.line === "number" ? edge.metadata.line : 1;
      if (edge.kind === "imports") {
        const specifier = edge.metadata?.source;
        if (
          typeof specifier !== "string" ||
          !source.ast.statements.some(
            (statement) =>
              ts.isImportDeclaration(statement) &&
              ts.isStringLiteral(statement.moduleSpecifier) &&
              statement.moduleSpecifier.text === specifier,
          )
        ) {
          reject(sourceFile, "unresolved_import");
          return undefined;
        }
        targetFile = resolveModule(sourceFile, specifier);
        if (!targetFile) {
          reject(sourceFile, "unresolved_module");
          return undefined;
        }
        targetSymbol = (await read(targetFile))?.symbols.find((symbol) => symbol.kind === "file");
      } else if (edge.kind === "calls") {
        let call: ts.CallExpression | undefined;
        const find = (node: ts.Node): void => {
          if (ts.isCallExpression(node)) {
            const target = ts.isPropertyAccessExpression(node.expression)
              ? node.expression.name
              : node.expression;
            if (target.getStart(source.ast) === edge.metadata?.position) call = node;
          }
          if (!call) ts.forEachChild(node, find);
        };
        find(source.ast);
        if (!call) {
          reject(sourceFile, "unresolved_call");
          return undefined;
        }
        const expression = call.expression;
        const bindingNode = ts.isPropertyAccessExpression(expression)
          ? expression.expression
          : expression;
        const binding = checker().getSymbolAtLocation(bindingNode);
        for (const declaration of binding?.declarations ?? []) {
          for (let node: ts.Node | undefined = declaration; node; node = node.parent) {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
              targetFile = resolveModule(sourceFile, node.moduleSpecifier.text);
              if (targetFile) await read(targetFile);
              break;
            }
          }
        }
        const typeChecker = checker();
        let symbol = typeChecker.getSymbolAtLocation(expression);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias)
          symbol = typeChecker.getAliasedSymbol(symbol);
        const resolved = (symbol?.declarations ?? []).flatMap((declaration) => {
          const file = inside(repoRoot, declaration.getSourceFile().fileName);
          if (!file || !files.has(file)) return [];
          const startLine =
            declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line +
            1;
          const name =
            "name" in declaration &&
            declaration.name &&
            ts.isIdentifier(declaration.name as ts.Node)
              ? (declaration.name as ts.Identifier).text
              : symbol!.name;
          return files
            .get(file)!
            .symbols.filter(
              (candidate) =>
                candidate.kind !== "file" &&
                candidate.name === name &&
                candidate.startLine === startLine,
            );
        });
        const unique = [...new Map(resolved.map((symbol) => [symbol.id, symbol])).values()];
        if (unique.length === 1) {
          targetSymbol = unique[0];
          targetFile = targetSymbol!.filePath;
        }
      }
      if (!targetFile || !targetSymbol || !files.has(targetFile) || denied.has(targetFile)) {
        reject(sourceFile, "unresolved_symbol");
        return undefined;
      }
      return {
        kind: edge.kind as "imports" | "calls",
        source: source.source,
        target: files.get(targetFile)!.source,
        sourceSymbolId: sourceSymbol.id,
        targetSymbolId: targetSymbol.id,
        sourceSymbol: sourceSymbol.name,
        targetSymbol: targetSymbol.name,
        line,
        depth: 1,
      };
    };
    const visited = new Set<string>();
    let frontier: string[] = [];
    for (const seed of [...new Set(input.seeds)].slice(0, maxNodes)) {
      if (await read(seed)) {
        visited.add(seed);
        frontier.push(seed);
      }
    }
    if (input.seeds.length > maxNodes) expansion.truncated = true;
    const imports = input.store.getEdgesByKind(repoRoot, "imports", MAX_SCANNED_EDGES + 1);
    if (imports.length > MAX_SCANNED_EDGES) expansion.truncated = true;
    const seenEdges = new Set<string>();
    for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
      const next = new Set<string>();
      let scanned = 0;
      for (const file of frontier) {
        if (scanned >= MAX_SCANNED_EDGES) {
          expansion.truncated = true;
          break;
        }
        const remaining = MAX_SCANNED_EDGES - scanned;
        const outgoing = input.store.getEdgesByFile(repoRoot, file, remaining + 1);
        if (outgoing.length > remaining) expansion.truncated = true;
        const incoming = imports
          .slice(0, MAX_SCANNED_EDGES)
          .filter(
            (edge) =>
              typeof edge.metadata?.sourceFile === "string" &&
              typeof edge.metadata?.source === "string" &&
              resolveModule(edge.metadata.sourceFile, edge.metadata.source) === file,
          );
        function* candidates(): Generator<{ edge: GraphEdge; incoming: boolean }> {
          for (const edge of outgoing.slice(0, remaining)) {
            if (edge.kind === "imports" || edge.kind === "calls") yield { edge, incoming: false };
          }
          for (const edge of incoming) yield { edge, incoming: true };
          for (const sourceFile of new Set(
            incoming.map((edge) => edge.metadata!.sourceFile as string),
          )) {
            if (sourceFile === file) continue;
            if (scanned >= MAX_SCANNED_EDGES) {
              expansion.truncated = true;
              return;
            }
            const available = MAX_SCANNED_EDGES - scanned;
            const calls = input.store.getEdgesByFile(repoRoot, sourceFile, available + 1);
            if (calls.length > available) expansion.truncated = true;
            for (const edge of calls.slice(0, available)) {
              if (edge.kind === "calls") yield { edge, incoming: true };
            }
          }
        }
        for (const candidate of candidates()) {
          const edge = candidate.edge;
          if (scanned >= MAX_SCANNED_EDGES || expansion.edges.length >= HARD_MAX_EDGES) {
            expansion.truncated = true;
            break;
          }
          scanned++;
          const sourceFile = edge.metadata?.sourceFile;
          if (typeof sourceFile !== "string") continue;
          const resolved = await resolveEdge(edge, sourceFile);
          if (!resolved) continue;
          if (candidate.incoming && resolved.target.subjectId !== file) continue;
          const key = JSON.stringify([
            resolved.kind,
            resolved.sourceSymbolId,
            resolved.targetSymbolId,
            resolved.line,
          ]);
          if (!seenEdges.has(key)) {
            seenEdges.add(key);
            expansion.edges.push({ ...resolved, depth });
          }
          for (const endpoint of [resolved.source.subjectId, resolved.target.subjectId]) {
            if (!visited.has(endpoint)) {
              visited.add(endpoint);
              next.add(endpoint);
            }
          }
        }
      }
      frontier = [...next];
    }
    for (const file of files.keys()) {
      if (!(await read(file, true))) {
        expansion.status = "unavailable";
        expansion.edges = [];
        return result();
      }
    }
    expansion.sources = [...visited].map((file) => files.get(file)!.source);
    await check("");
    if (!revalidateCodeRelationships({ store: input.store, repoRoot, expansion })) return result();
    const snippets: Array<ContextSnippet & { sourceRef: SourceRefV2 }> = [];
    let remaining = Math.min(24000, Math.max(0, Math.floor(input.budgetChars ?? 6000)));
    for (const file of visited) {
      const pinned = files.get(file)!;
      if (!remaining) {
        expansion.truncated = true;
        continue;
      }
      const call = expansion.edges.find(
        (edge) => edge.kind === "calls" && edge.target.subjectId === file,
      );
      const symbol = call && pinned.symbols.find((symbol) => symbol.id === call.targetSymbolId);
      const lines = pinned.text.split(/(?<=\n)/);
      const startLine = symbol ? Math.max(1, symbol.startLine - 1) : 1;
      const prefix = lines.slice(0, startLine - 1).join("");
      const selected = symbol ? lines.slice(startLine - 1, symbol.endLine).join("") : pinned.text;
      let endChar = Math.min(remaining, 3000, selected.length);
      if (endChar && /[\uD800-\uDBFF]/.test(selected[endChar - 1]!)) endChar--;
      const content = selected.slice(0, endChar);
      remaining -= content.length;
      if (content.length < selected.length) expansion.truncated = true;
      if (!content) continue;
      const returnedLines = (content.slice(0, -1).match(/\n/g)?.length ?? 0) + 1;
      snippets.push({
        filePath: file,
        startLine,
        endLine: startLine + returnedLines - 1,
        content,
        score: 1,
        reason: "Owner-admitted exact code relationship",
        role: "source",
        expansionLevel: "focused_body",
        originalLineCount: pinned.text.split("\n").length,
        returnedLineCount: returnedLines,
        elidedLineCount: Math.max(0, pinned.text.split("\n").length - returnedLines),
        sourceRef: {
          ...pinned.source,
          locator: {
            coordinateSpace: "raw-source-utf8-v1",
            startByte: Buffer.byteLength(prefix),
            endByteExclusive: Buffer.byteLength(prefix + content),
            startLine,
            endLine: startLine + returnedLines - 1,
          },
        },
      });
    }
    if (!visited.size) {
      expansion.status = "unavailable";
      reject("", "missing_relation_seed");
    } else if (expansion.rejected.length || expansion.truncated) expansion.status = "partial";
    return { expansion, snippets };
  } catch (error) {
    reject("", error instanceof Error ? error.message : "code_owner_unavailable");
    expansion.status = "unavailable";
    expansion.sources = [];
    expansion.edges = [];
    return result();
  }
}
