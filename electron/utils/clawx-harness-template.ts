/**
 * Verse Claw workspace harness template seeding.
 *
 * This is intentionally best-effort: workspace/project creation should not
 * fail just because the optional guidance files could not be written.
 */
import { access, mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join, resolve } from 'path';
import { logger } from './logger';
import { getResourcesDir } from './paths';

const TEMPLATE_DIR_NAME = 'workspace-harness';
const TARGET_DIR_SEGMENTS = ['.verse-claw', 'harness'] as const;

export type VerseClawWorkspaceHarnessSkippedReason =
  | 'missing-workspace'
  | 'missing-template'
  | 'error';

export interface VerseClawWorkspaceHarnessResult {
  workspaceDir: string;
  templateDir: string;
  targetDir: string;
  filesWritten: number;
  skippedReason?: VerseClawWorkspaceHarnessSkippedReason;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeFileIfMissing(path: string, content: Buffer): Promise<boolean> {
  try {
    await writeFile(path, content, { flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

async function copyTemplateFiles(sourceDir: string, targetDir: string): Promise<number> {
  await mkdir(targetDir, { recursive: true });

  let filesWritten = 0;
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      filesWritten += await copyTemplateFiles(sourcePath, targetPath);
      continue;
    }

    if (!entry.isFile()) continue;

    const content = await readFile(sourcePath);
    if (await writeFileIfMissing(targetPath, content)) {
      filesWritten += 1;
    }
  }

  return filesWritten;
}

export async function ensureVerseClawWorkspaceHarness(
  workspaceDir: string,
  options: { createDir?: boolean } = {},
): Promise<VerseClawWorkspaceHarnessResult> {
  const resolvedWorkspaceDir = resolve(workspaceDir);
  const templateDir = join(getResourcesDir(), TEMPLATE_DIR_NAME);
  const targetDir = join(resolvedWorkspaceDir, ...TARGET_DIR_SEGMENTS);
  const baseResult: VerseClawWorkspaceHarnessResult = {
    workspaceDir: resolvedWorkspaceDir,
    templateDir,
    targetDir,
    filesWritten: 0,
  };

  try {
    if (options.createDir) {
      await mkdir(resolvedWorkspaceDir, { recursive: true });
    } else if (!(await fileExists(resolvedWorkspaceDir))) {
      return { ...baseResult, skippedReason: 'missing-workspace' };
    }

    if (!(await fileExists(templateDir))) {
      logger.debug(`Verse Claw workspace harness template not found: ${templateDir}`);
      return { ...baseResult, skippedReason: 'missing-template' };
    }

    const filesWritten = await copyTemplateFiles(templateDir, targetDir);
    if (filesWritten > 0) {
      logger.info(`Seeded Verse Claw workspace harness (${filesWritten} file(s)) at ${targetDir}`);
    }

    return { ...baseResult, filesWritten };
  } catch (error) {
    logger.warn('Failed to seed Verse Claw workspace harness', {
      workspaceDir: resolvedWorkspaceDir,
      targetDir,
      error,
    });
    return { ...baseResult, skippedReason: 'error' };
  }
}
