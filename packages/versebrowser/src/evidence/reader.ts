/**
 * EvidenceReader — restore an offline Evidence Pack for review / replay / critic.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertInsideRoot, EvidencePathError } from './path-guard.ts';
import {
  EVIDENCE_PACK_SCHEMA_VERSION,
  PACK_FILES,
  type EvidencePackContents,
  type EvidencePackManifest,
} from './schema.ts';

export async function readEvidencePack(packDir: string): Promise<EvidencePackContents> {
  const manifest = JSON.parse(
    await readFile(assertInsideRoot(packDir, join(packDir, PACK_FILES.manifest), 'manifest'), 'utf8'),
  ) as EvidencePackManifest;

  if (manifest.schemaVersion !== EVIDENCE_PACK_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported evidence pack schemaVersion ${manifest.schemaVersion} (expected ${EVIDENCE_PACK_SCHEMA_VERSION})`,
    );
  }

  const readJson = async <T>(name: string): Promise<T | undefined> => {
    const path = assertInsideRoot(packDir, join(packDir, name), 'pack file');
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch {
      return undefined;
    }
  };
  const readText = async (name: string): Promise<string | undefined> => {
    const path = assertInsideRoot(packDir, join(packDir, name), 'pack file');
    try {
      return await readFile(path, 'utf8');
    } catch {
      return undefined;
    }
  };

  const shotsDir = assertInsideRoot(packDir, join(packDir, PACK_FILES.shotsDir), 'screenshots directory');
  let screenshots: string[];
  try {
    const shots = await readdir(shotsDir);
    screenshots = shots.filter((name) => name.toLowerCase().endsWith('.png')).map((name) => assertInsideRoot(packDir, join(shotsDir, name), 'screenshot'));
  } catch (error) {
    if (error instanceof EvidencePathError) throw error;
    screenshots = [];
  }

  return {
    manifest,
    summaryMarkdown: await readText(PACK_FILES.summary),
    consoleDiff: await readJson(PACK_FILES.console),
    consoleText: await readText(PACK_FILES.consoleText),
    networkFailures: await readJson(PACK_FILES.network),
    explain: await readJson(PACK_FILES.explain),
    verify: await readJson(PACK_FILES.verify),
    diagnosis: await readJson(PACK_FILES.diagnosisJson),
    timeline: await readJson(PACK_FILES.timeline),
    prComment: await readText(PACK_FILES.prComment),
    screenshots,
  };
}

/** Compact human summary for CLI / agent context (no binary payloads). */
export function formatEvidencePackSummary(contents: EvidencePackContents): string {
  const { manifest } = contents;
  const lines = [
    `# Evidence Pack ${manifest.packId}`,
    '',
    `- label: ${manifest.label}`,
    `- createdAt: ${manifest.createdAt}`,
    manifest.sessionId ? `- sessionId: ${manifest.sessionId}` : '',
    `- files: ${manifest.files.length}`,
    `- screenshots: ${contents.screenshots.length}`,
  ].filter(Boolean);

  if (contents.verify) {
    lines.push('', `verify: ${contents.verify.ok ? 'PASS' : 'FAIL'}`);
  }
  if (contents.networkFailures) {
    lines.push(`network failures: ${contents.networkFailures.count}`);
  }
  if (contents.consoleDiff) {
    lines.push(
      `console delta: +${contents.consoleDiff.newErrors.length} errors, +${contents.consoleDiff.newWarnings.length} warnings`,
    );
  }
  if (contents.explain?.primary) {
    const primary = contents.explain.primary;
    const loc = primary.originalLine
      ? `${primary.source ?? primary.url}:${primary.originalLine}`
      : `${primary.url}:${primary.line}`;
    lines.push(`explain primary: ${loc}`);
  }
  return lines.join('\n');
}
