/**
 * EvidenceWriter — materialize an offline Evidence Pack directory.
 */
import { mkdir, readdir, stat } from 'node:fs/promises';
import { writeEvidenceText, writeEvidenceJson, writeEvidenceBinary } from './output.ts';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createEvidenceRef,
  errResult,
  okResult,
  type EvidenceRef,
  type ToolResult,
} from '../contracts/index.ts';
import {
  EVIDENCE_PACK_SCHEMA_VERSION,
  PACK_FILES,
  type EvidencePackContents,
  type EvidencePackManifest,
} from './schema.ts';
import { getWorkspaceEvidenceRoot, toWorkspaceRelative } from '../host/workspace-paths.ts';
import { assertInsideRoot, sanitizeSegment } from './path-guard.ts';

export type WriteEvidencePackInput = {
  /** Parent directory; pack is written under `<root>/<packId>/`.
   *  Default: `<workspace>/.ae/evidence` (workspace jail). */
  rootDir?: string;
  packId?: string;
  label: string;
  sessionId?: string;
  summaryMarkdown?: string;
  consoleDiff?: EvidencePackContents['consoleDiff'];
  networkFailures?: EvidencePackContents['networkFailures'];
  consoleText?: string;
  explain?: EvidencePackContents['explain'];
  verify?: EvidencePackContents['verify'];
  diagnosis?: EvidencePackContents['diagnosis'];
  timeline?: EvidencePackContents['timeline'];
  prComment?: string;
  /** PNG data URLs or absolute paths to copy-reference (paths only recorded). */
  screenshots?: Array<{ dataUrl?: string; path?: string; name?: string }>;
  notes?: string;
};

export type WriteEvidencePackResult = {
  packDir: string;
  manifest: EvidencePackManifest;
  evidence: EvidenceRef[];
};

export async function writeEvidencePack(
  input: WriteEvidencePackInput,
): Promise<WriteEvidencePackResult> {
  const packId = sanitizeSegment(input.packId ?? `pack-${randomUUID().slice(0, 8)}`, 'pack');
  const rootDir = input.rootDir ?? getWorkspaceEvidenceRoot();
  const packDir = assertInsideRoot(rootDir, join(rootDir, packId), 'pack directory');
  const shotsDir = assertInsideRoot(packDir, join(packDir, PACK_FILES.shotsDir), 'screenshots directory');
  await mkdir(shotsDir, { recursive: true });

  const files: EvidencePackManifest['files'] = [];
  const evidence: EvidenceRef[] = [];

  const put = async (
    name: string,
    content: unknown,
    kind: EvidenceRef['kind'],
    mimeType: string,
  ): Promise<string> => {
    const path = assertInsideRoot(packDir, join(packDir, name), 'pack file');
    const written = mimeType === 'application/json'
      ? await writeEvidenceJson(packDir, path, content)
      : await writeEvidenceText(packDir, path, String(content));
    const size = Buffer.byteLength(written);
    files.push({ path: name, kind, mimeType, size });
    evidence.push(
      createEvidenceRef({ kind, label: name, path: toWorkspaceRelative(path) ?? path, mimeType, size }),
    );
    return path;
  };

  if (input.summaryMarkdown !== undefined) {
    await put(PACK_FILES.summary, input.summaryMarkdown, 'summary', 'text/markdown');
  }
  if (input.consoleDiff !== undefined) {
    await put(PACK_FILES.console, input.consoleDiff, 'console', 'application/json');
  }
  if (input.consoleText !== undefined) {
    await put(PACK_FILES.consoleText, input.consoleText, 'console', 'text/plain');
  }
  if (input.networkFailures !== undefined) {
    await put(
      PACK_FILES.network,
      input.networkFailures,
      'network',
      'application/json',
    );
  }
  if (input.explain !== undefined) {
    await put(PACK_FILES.explain, input.explain, 'explain', 'application/json');
  }
  if (input.verify !== undefined) {
    await put(PACK_FILES.verify, input.verify, 'verify', 'application/json');
  }
  if (input.timeline !== undefined) {
    await put(PACK_FILES.timeline, input.timeline, 'timeline', 'application/json');
  }
  if (input.diagnosis !== undefined) {
    await put(PACK_FILES.diagnosisJson, input.diagnosis, 'summary', 'application/json');
    await put(PACK_FILES.diagnosis, input.diagnosis.summaryMarkdown, 'summary', 'text/markdown');
  }
  if (input.prComment !== undefined) {
    await put(PACK_FILES.prComment, input.prComment, 'summary', 'text/markdown');
  }

  let shotIndex = 0;
  for (const shot of input.screenshots ?? []) {
    shotIndex += 1;
    const name = sanitizeSegment(shot.name ?? `shot-${shotIndex}.png`, `shot-${shotIndex}.png`);
    const safe = name.endsWith('.png') ? name : `${name}.png`;
    if (shot.dataUrl) {
      const match = /^data:image\/png;base64,(.+)$/s.exec(shot.dataUrl);
      if (!match) throw new Error('screenshot dataUrl is not PNG base64');
      const buffer = Buffer.from(match[1], 'base64');
      await writeEvidenceBinary(packDir, join(shotsDir, safe), buffer);
      files.push({ path: `${PACK_FILES.shotsDir}/${safe}`, kind: 'screenshot', mimeType: 'image/png', size: buffer.byteLength });
      evidence.push(
        createEvidenceRef({
          kind: 'screenshot',
          label: safe,
          path: toWorkspaceRelative(join(shotsDir, safe)) ?? join(shotsDir, safe),
          mimeType: 'image/png',
          size: buffer.byteLength,
        }),
      );
    } else if (shot.path) {
      // External shot: record reference only (caller already owns the file).
      files.push({ path: shot.path, kind: 'screenshot', mimeType: 'image/png' });
      evidence.push(
        createEvidenceRef({
          kind: 'screenshot',
          label: safe,
          path: toWorkspaceRelative(shot.path) ?? shot.path,
          mimeType: 'image/png',
        }),
      );
    }
  }

  const manifest: EvidencePackManifest = {
    schemaVersion: EVIDENCE_PACK_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    packId,
    label: input.label,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    files,
    ...(input.notes ? { notes: input.notes } : {}),
  };
  const writtenManifest = await writeEvidenceJson(packDir, join(packDir, PACK_FILES.manifest), manifest);
  evidence.unshift(
    createEvidenceRef({
      kind: 'summary',
      label: 'manifest',
      path: toWorkspaceRelative(join(packDir, PACK_FILES.manifest)) ?? join(packDir, PACK_FILES.manifest),
      mimeType: 'application/json',
    }),
  );

  return { packDir, manifest: JSON.parse(writtenManifest) as EvidencePackManifest, evidence };
}

export async function writeEvidencePackToolResult(
  input: WriteEvidencePackInput,
): Promise<ToolResult> {
  try {
    const result = await writeEvidencePack(input);
    return okResult(
      `evidence pack written: ${result.packDir}`,
      { packDir: result.packDir, packId: result.manifest.packId, files: result.manifest.files },
      result.evidence,
    );
  } catch (error) {
    return errResult('E_EVIDENCE_WRITE', error instanceof Error ? error.message : String(error));
  }
}

/** List pack directories under root (one level). */
export async function listEvidencePacks(rootDir: string): Promise<string[]> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function pathSize(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : undefined;
  } catch {
    return undefined;
  }
}
