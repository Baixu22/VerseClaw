#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function collectArtifactInventory(artifactsDir) {
  const base = resolve(artifactsDir);
  const files = [];
  await walk(base, base, files);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export function parsePnpmLockComponents(lockText) {
  const lines = String(lockText).split(/\r?\n/u);
  const components = [];
  let inPackages = false;
  let current = null;
  const flush = () => {
    if (!current) return;
    const key = current.key.replace(/^['"]|['"]$/gu, '');
    const split = key.lastIndexOf('@');
    if (split > 0 && !key.startsWith('file:') && !key.startsWith('link:')) {
      const name = key.slice(0, split);
      const version = key.slice(split + 1);
      const component = {
        type: 'library',
        name,
        version,
        'bom-ref': `pkg:npm/${encodePurlName(name)}@${encodeURIComponent(version)}`,
        purl: `pkg:npm/${encodePurlName(name)}@${encodeURIComponent(version)}`,
      };
      if (current.integrity?.startsWith('sha512-')) {
        const digest = Buffer.from(current.integrity.slice('sha512-'.length), 'base64');
        if (digest.length === 64) {
          component.hashes = [{ alg: 'SHA-512', content: digest.toString('hex') }];
        }
      }
      components.push(component);
    }
    current = null;
  };

  for (const line of lines) {
    if (line === 'packages:') {
      inPackages = true;
      continue;
    }
    if (line === 'snapshots:') {
      flush();
      break;
    }
    if (!inPackages) continue;
    const entry = /^ {2}(\S.*):$/u.exec(line);
    if (entry) {
      flush();
      current = { key: entry[1], integrity: null };
      continue;
    }
    const integrity = /^    resolution:.*\bintegrity:\s*([^,}\s]+)/u.exec(line);
    if (current && integrity) current.integrity = integrity[1].replace(/^['"]|['"]$/gu, '');
  }
  return components.sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));
}

export function buildReleaseSbom({ inventory, packageJson, lockText, context }) {
  const artifactComponents = inventory.map((artifact) => ({
    type: 'file',
    name: artifact.name,
    'bom-ref': `artifact:${artifact.name}`,
    hashes: [{ alg: 'SHA-256', content: artifact.sha256 }],
    properties: [
      { name: 'clawx:release-artifact', value: 'true' },
      { name: 'clawx:size', value: String(artifact.size) },
    ],
  }));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      timestamp: context.generatedAt,
      component: {
        type: 'application',
        name: packageJson.productName || packageJson.name,
        version: context.version,
        'bom-ref': `application:${packageJson.name}@${context.version}`,
      },
      properties: [
        { name: 'clawx:repository', value: context.repository },
        { name: 'clawx:git-commit', value: context.commit },
        { name: 'clawx:git-ref', value: context.ref },
        { name: 'clawx:run-id', value: context.runId },
        { name: 'clawx:pnpm-lock-sha256', value: sha256Text(lockText) },
      ],
    },
    components: [...artifactComponents, ...parsePnpmLockComponents(lockText)],
  };
}

export function buildReleaseProvenance({ inventory, context, lockText }) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: inventory.map((artifact) => ({
      name: artifact.name,
      digest: { sha256: artifact.sha256 },
    })),
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://github.com/IntelliSpectrum/ClawX/.github/workflows/release.yml@v1',
        externalParameters: {
          version: context.version,
          ref: context.ref,
          repository: context.repository,
        },
        internalParameters: {
          pnpmLockSha256: sha256Text(lockText),
        },
        resolvedDependencies: [
          {
            uri: `git+https://github.com/${context.repository}.git`,
            digest: { gitCommit: context.commit },
          },
        ],
      },
      runDetails: {
        builder: {
          id: `https://github.com/${context.repository}/actions/runs/${context.runId}`,
        },
        metadata: {
          invocationId: `${context.repository}/${context.runId}/${context.runAttempt}`,
          startedOn: context.generatedAt,
          finishedOn: context.generatedAt,
        },
      },
    },
  };
}

export async function generateReleaseTrustMetadata(options) {
  const artifactsDir = resolve(options.artifactsDir);
  const outputDir = resolve(options.outputDir);
  const packageJson = JSON.parse(await readFile(options.packageJsonPath || join(root, 'package.json'), 'utf8'));
  const lockText = await readFile(options.lockfilePath || join(root, 'pnpm-lock.yaml'), 'utf8');
  const inventory = await collectArtifactInventory(artifactsDir);
  if (inventory.length === 0) throw new Error('release artifact inventory is empty');
  const context = {
    version: options.version,
    commit: options.commit,
    repository: options.repository,
    ref: options.ref,
    runId: options.runId,
    runAttempt: options.runAttempt,
    generatedAt: options.generatedAt || new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(context)) {
    if (!value) throw new Error(`release trust context is missing ${key}`);
  }
  const sbom = buildReleaseSbom({ inventory, packageJson, lockText, context });
  const provenance = buildReleaseProvenance({ inventory, context, lockText });
  await mkdir(outputDir, { recursive: true });
  const inventoryPath = join(outputDir, 'release-artifact-inventory.json');
  const sbomPath = join(outputDir, 'release-sbom.cdx.json');
  const provenancePath = join(outputDir, 'release-provenance.intoto.json');
  await writeJson(inventoryPath, { schemaVersion: 1, generatedAt: context.generatedAt, artifacts: inventory });
  await writeJson(sbomPath, sbom);
  await writeJson(provenancePath, provenance);
  return { inventory, inventoryPath, sbomPath, provenancePath };
}

async function walk(base, directory, files) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) await walk(base, fullPath, files);
    else if (entry.isFile()) {
      const fileStat = await stat(fullPath);
      files.push({
        name: relative(base, fullPath).replaceAll('\\', '/'),
        size: fileStat.size,
        sha256: await sha256File(fullPath),
      });
    }
  }
}

async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function encodePurlName(name) {
  return name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateReleaseTrustMetadata({
    artifactsDir: readArg('--artifacts'),
    outputDir: readArg('--out'),
    version: readArg('--version'),
    commit: readArg('--commit'),
    repository: readArg('--repository'),
    ref: readArg('--ref'),
    runId: readArg('--run-id'),
    runAttempt: readArg('--run-attempt'),
  })
    .then((result) => {
      console.log(
        `[release-trust] generated artifacts=${result.inventory.length} sbom=${basename(result.sbomPath)} provenance=${basename(result.provenancePath)}`,
      );
    })
    .catch((error) => {
      console.error(`[release-trust] FAIL: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
