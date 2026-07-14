import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';

import type { AgencyDraftRoleEntry } from '../../openclaw_runtime/src/agents/agency-draft-catalog';
import { importAgencyDraftRolesFromRepository } from '../../openclaw_runtime/src/agents/agency-role-importer';
import { getDataDir } from '../utils/paths';

const SCHEMA_VERSION = 1 as const;
const IMPORTER_VERSION = 'agency-role-importer-v1';

export type AgencyRolePackageCompleteness = 'complete' | 'legacy-reconstructed';

type AgencyRolePackageManifest = {
  schemaVersion: typeof SCHEMA_VERSION;
  importerVersion: string;
  packageId: string;
  importedAt: string;
  completeness: AgencyRolePackageCompleteness;
  draftId: string;
  sourceRef: {
    relativePath: string;
    sha256: string;
  };
  sourceDivision?: string;
  matchedRunbooks: string[];
  supersedesPackageId?: string;
  files: Record<string, string>;
};

export type AgencyRolePackage = {
  packageId: string;
  importedAt: string;
  completeness: AgencyRolePackageCompleteness;
  draftId: string;
  sourceRef: AgencyRolePackageManifest['sourceRef'];
  sourceDivision?: string;
  matchedRunbooks: string[];
  supersedesPackageId?: string;
  draft: AgencyDraftRoleEntry;
  sourcePath?: string;
  licensePath?: string;
};

type PackageStoreOptions = {
  baseDir?: string;
  now?: () => Date;
};

type PackageContent = {
  draft: AgencyDraftRoleEntry;
  sourceRef: AgencyRolePackageManifest['sourceRef'];
  completeness: AgencyRolePackageCompleteness;
  source?: Buffer;
  license?: Buffer;
  matchedRunbooks?: string[];
  importedAt?: string;
  supersedesPackageId?: string;
};

export type AgencyRolePackageStore = {
  list(): Promise<AgencyRolePackage[]>;
  get(packageId: string): Promise<AgencyRolePackage>;
  importFromRepository(payload: {
    sourceRoot: string;
    draftId: string;
  }): Promise<AgencyRolePackage>;
  refreshFromRepository(payload: {
    packageId: string;
    sourceRoot: string;
  }): Promise<AgencyRolePackage>;
  reconstructLegacy(payload: {
    draft: AgencyDraftRoleEntry;
    sourceRef: AgencyRolePackageManifest['sourceRef'];
    importedAt?: string;
  }): Promise<AgencyRolePackage>;
};

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function draftBytes(draft: AgencyDraftRoleEntry): Buffer {
  return Buffer.from(`${JSON.stringify(draft, null, 2)}\n`, 'utf8');
}

function packageIdentity(manifest: Omit<AgencyRolePackageManifest, 'packageId' | 'importedAt'>): string {
  return sha256(canonicalJson(manifest));
}

function contentIdentity(content: PackageContent): string {
  const draft = structuredClone(content.draft);
  return packageIdentity({
    schemaVersion: SCHEMA_VERSION,
    importerVersion: IMPORTER_VERSION,
    completeness: content.completeness,
    draftId: draft.id,
    sourceRef: content.sourceRef,
    sourceDivision: draft.sourceDivision,
    matchedRunbooks: [...new Set(content.matchedRunbooks ?? [])].sort(),
    files: {
      'draft.json': sha256(draftBytes(draft)),
      ...(content.source ? { 'source.md': sha256(content.source) } : {}),
      ...(content.license ? { 'LICENSE.txt': sha256(content.license) } : {}),
    },
  });
}

function safePackageId(packageId: string): string {
  if (!/^[a-f0-9]{64}$/.test(packageId)) throw new Error('Agency role package id is invalid.');
  return packageId;
}

function safeSourcePath(root: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath)) {
    throw new Error('Agency role package source path must be repository-relative.');
  }
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, relativePath);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Agency role package source path escapes the repository.');
  }
  return target;
}

function runbookContainsAgent(value: unknown, slug: string): boolean {
  if (Array.isArray(value)) return value.some((entry) => runbookContainsAgent(entry, slug));
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.agents) && record.agents.includes(slug)) return true;
  return Object.values(record).some((entry) => runbookContainsAgent(entry, slug));
}

function matchedRunbooks(runbooks: Array<Record<string, unknown>>, relativePath: string): string[] {
  const slug = basename(relativePath).replace(/\.md$/i, '');
  return runbooks.flatMap((runbook) => (
    runbookContainsAgent(runbook, slug) && typeof runbook.slug === 'string'
      ? [runbook.slug]
      : []
  ));
}

async function optionalFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

function packageFrom(
  manifest: AgencyRolePackageManifest,
  draft: AgencyDraftRoleEntry,
  packageDir: string,
): AgencyRolePackage {
  return {
    packageId: manifest.packageId,
    importedAt: manifest.importedAt,
    completeness: manifest.completeness,
    draftId: manifest.draftId,
    sourceRef: { ...manifest.sourceRef },
    ...(manifest.sourceDivision ? { sourceDivision: manifest.sourceDivision } : {}),
    matchedRunbooks: [...manifest.matchedRunbooks],
    ...(manifest.supersedesPackageId
      ? { supersedesPackageId: manifest.supersedesPackageId }
      : {}),
    draft,
    sourcePath: manifest.files['source.md'] ? join(packageDir, 'source.md') : undefined,
    licensePath: manifest.files['LICENSE.txt'] ? join(packageDir, 'LICENSE.txt') : undefined,
  };
}

export function createAgencyRolePackageStore(
  options: PackageStoreOptions = {},
): AgencyRolePackageStore {
  const root = join(options.baseDir ?? join(getDataDir(), 'agency-role-packages'), 'v1');
  const now = options.now ?? (() => new Date());

  const readPackage = async (rawPackageId: string): Promise<AgencyRolePackage> => {
    const packageId = safePackageId(rawPackageId);
    const packageDir = join(root, packageId);
    let manifest: AgencyRolePackageManifest;
    try {
      manifest = JSON.parse(await readFile(join(packageDir, 'manifest.json'), 'utf8')) as AgencyRolePackageManifest;
    } catch {
      throw new Error('Agency role package manifest is missing or invalid.');
    }
    if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.packageId !== packageId) {
      throw new Error('Agency role package schema or identity is invalid.');
    }
    const identityInput = {
      schemaVersion: manifest.schemaVersion,
      importerVersion: manifest.importerVersion,
      completeness: manifest.completeness,
      draftId: manifest.draftId,
      sourceRef: manifest.sourceRef,
      sourceDivision: manifest.sourceDivision,
      matchedRunbooks: manifest.matchedRunbooks,
      supersedesPackageId: manifest.supersedesPackageId,
      files: manifest.files,
    };
    if (packageIdentity(identityInput) !== packageId) {
      throw new Error('Agency role package integrity check failed.');
    }
    for (const [name, expectedHash] of Object.entries(manifest.files)) {
      const bytes = await readFile(join(packageDir, name)).catch(() => undefined);
      if (!bytes || sha256(bytes) !== expectedHash) {
        throw new Error(`Agency role package integrity check failed for ${name}.`);
      }
    }
    const draft = JSON.parse(await readFile(join(packageDir, 'draft.json'), 'utf8')) as AgencyDraftRoleEntry;
    if (draft.id !== manifest.draftId || draft.status !== 'draft') {
      throw new Error('Agency role package draft identity is invalid.');
    }
    return packageFrom(manifest, draft, packageDir);
  };

  const writePackage = async (content: PackageContent): Promise<AgencyRolePackage> => {
    const draft = structuredClone(content.draft);
    const files: Record<string, string> = {
      'draft.json': sha256(draftBytes(draft)),
      ...(content.source ? { 'source.md': sha256(content.source) } : {}),
      ...(content.license ? { 'LICENSE.txt': sha256(content.license) } : {}),
    };
    const identityInput = {
      schemaVersion: SCHEMA_VERSION,
      importerVersion: IMPORTER_VERSION,
      completeness: content.completeness,
      draftId: draft.id,
      sourceRef: content.sourceRef,
      sourceDivision: draft.sourceDivision,
      matchedRunbooks: [...new Set(content.matchedRunbooks ?? [])].sort(),
      supersedesPackageId: content.supersedesPackageId,
      files,
    } satisfies Omit<AgencyRolePackageManifest, 'packageId' | 'importedAt'>;
    const packageId = packageIdentity(identityInput);
    const packageDir = join(root, packageId);
    try {
      await access(packageDir);
      return readPackage(packageId);
    } catch {
      // The content-addressed directory is created below.
    }

    await mkdir(root, { recursive: true });
    const tempDir = join(root, `.${packageId}.${randomUUID()}.tmp`);
    const manifest: AgencyRolePackageManifest = {
      ...identityInput,
      packageId,
      importedAt: content.importedAt ?? now().toISOString(),
    };
    try {
      await mkdir(tempDir);
      await writeFile(join(tempDir, 'draft.json'), draftBytes(draft));
      if (content.source) await writeFile(join(tempDir, 'source.md'), content.source);
      if (content.license) await writeFile(join(tempDir, 'LICENSE.txt'), content.license);
      await writeFile(join(tempDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      for (const [name, expectedHash] of Object.entries(files)) {
        if (sha256(await readFile(join(tempDir, name))) !== expectedHash) {
          throw new Error(`Agency role package write verification failed for ${name}.`);
        }
      }
      await rename(tempDir, packageDir);
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      try {
        return await readPackage(packageId);
      } catch {
        throw error;
      }
    }
    return readPackage(packageId);
  };

  const readRepositoryContent = async (
    payload: { sourceRoot: string; draftId: string },
  ): Promise<PackageContent> => {
    const catalog = importAgencyDraftRolesFromRepository(payload.sourceRoot);
    const draft = catalog.entries.find((entry) => entry.id === payload.draftId);
    if (!draft?.sourceRef) throw new Error(`Agency draft "${payload.draftId}" was not found.`);
    const sourcePath = safeSourcePath(payload.sourceRoot, draft.sourceRef.relativePath);
    const source = await readFile(sourcePath);
    if (sha256(source) !== draft.sourceRef.sha256) {
      throw new Error('Agency source changed while the package was being imported.');
    }
    return {
      draft,
      sourceRef: draft.sourceRef,
      completeness: 'complete',
      source,
      license: await optionalFile(join(payload.sourceRoot, 'LICENSE')),
      matchedRunbooks: matchedRunbooks(catalog.runbooks, draft.sourceRef.relativePath),
    };
  };

  return {
    list: async () => {
      await mkdir(root, { recursive: true });
      const entries = await readdir(root, { withFileTypes: true });
      const packages: AgencyRolePackage[] = [];
      for (const entry of entries) {
        if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) {
          packages.push(await readPackage(entry.name));
        }
      }
      return packages.sort((left, right) => right.importedAt.localeCompare(left.importedAt));
    },
    get: readPackage,
    importFromRepository: async (payload) => writePackage(await readRepositoryContent(payload)),
    refreshFromRepository: async (payload) => {
      const current = await readPackage(payload.packageId);
      const candidate = await readRepositoryContent({
        sourceRoot: payload.sourceRoot,
        draftId: current.draftId,
      });
      const currentContent: PackageContent = {
        draft: current.draft,
        sourceRef: current.sourceRef,
        completeness: current.completeness,
        source: current.sourcePath ? await readFile(current.sourcePath) : undefined,
        license: current.licensePath ? await readFile(current.licensePath) : undefined,
        matchedRunbooks: current.matchedRunbooks,
      };
      if (contentIdentity(candidate) === contentIdentity(currentContent)) return current;
      return writePackage({
        draft: candidate.draft,
        sourceRef: candidate.sourceRef,
        completeness: 'complete',
        source: candidate.source,
        license: candidate.license,
        matchedRunbooks: candidate.matchedRunbooks,
        supersedesPackageId: current.packageId,
      });
    },
    reconstructLegacy: (payload) => writePackage({
      draft: payload.draft,
      sourceRef: payload.sourceRef,
      completeness: 'legacy-reconstructed',
      importedAt: payload.importedAt,
    }),
  };
}
