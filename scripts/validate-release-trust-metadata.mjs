#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectArtifactInventory,
  parsePnpmLockComponents,
} from './generate-release-trust-metadata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function validateReleaseTrustMetadata(options) {
  const actual = await collectArtifactInventory(options.artifactsDir);
  const inventoryDocument = await readJson(options.inventoryPath);
  const sbom = await readJson(options.sbomPath);
  const provenance = await readJson(options.provenancePath);
  const lockText = await readFile(options.lockfilePath || join(root, 'pnpm-lock.yaml'), 'utf8');
  assertExactSubjects('inventory', actual, inventoryDocument.artifacts || []);

  if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.6') {
    throw new Error('SBOM must be CycloneDX 1.6');
  }
  const sbomArtifacts = (sbom.components || [])
    .filter((component) =>
      component.properties?.some(
        (property) => property.name === 'clawx:release-artifact' && property.value === 'true',
      ),
    )
    .map((component) => ({
      name: component.name,
      size: Number(component.properties.find((property) => property.name === 'clawx:size')?.value),
      sha256: component.hashes?.find((hash) => hash.alg === 'SHA-256')?.content,
    }));
  assertExactSubjects('SBOM', actual, sbomArtifacts);
  assertExactDependencies(
    parsePnpmLockComponents(lockText),
    (sbom.components || []).filter((component) => component.type === 'library'),
  );
  const sbomProperties = Object.fromEntries(
    (sbom.metadata?.properties || []).map((property) => [property.name, property.value]),
  );
  if (sbomProperties['clawx:pnpm-lock-sha256'] !== sha256Text(lockText)) {
    throw new Error('SBOM pnpm lock digest mismatch');
  }
  if (options.version && sbom.metadata?.component?.version !== options.version) {
    throw new Error('SBOM version mismatch');
  }
  if (options.commit && sbomProperties['clawx:git-commit'] !== options.commit) {
    throw new Error('SBOM commit mismatch');
  }

  if (
    provenance._type !== 'https://in-toto.io/Statement/v1' ||
    provenance.predicateType !== 'https://slsa.dev/provenance/v1'
  ) {
    throw new Error('provenance must be an in-toto SLSA v1 statement');
  }
  const provenanceSubjects = (provenance.subject || []).map((subject) => ({
    name: subject.name,
    sha256: subject.digest?.sha256,
    size: actual.find((artifact) => artifact.name === subject.name)?.size,
  }));
  assertExactSubjects('provenance', actual, provenanceSubjects);

  if (options.version && provenance.predicate?.buildDefinition?.externalParameters?.version !== options.version) {
    throw new Error('provenance version mismatch');
  }
  if (
    options.commit &&
    provenance.predicate?.buildDefinition?.resolvedDependencies?.[0]?.digest?.gitCommit !== options.commit
  ) {
    throw new Error('provenance commit mismatch');
  }
  if (
    options.repository &&
    provenance.predicate?.buildDefinition?.resolvedDependencies?.[0]?.uri !==
      `git+https://github.com/${options.repository}.git`
  ) {
    throw new Error('provenance repository mismatch');
  }
  if (
    options.ref &&
    provenance.predicate?.buildDefinition?.externalParameters?.ref !== options.ref
  ) {
    throw new Error('provenance ref mismatch');
  }
  return { artifacts: actual.length, dependencies: parsePnpmLockComponents(lockText).length };
}

export function validateElectronBuilderTrustPolicy(text) {
  const source = String(text);
  const required = [
    ['asar', /^asar:\s*true\s*$/mu],
    ['embedded-asar-integrity', /^\s{2}enableEmbeddedAsarIntegrityValidation:\s*true\s*$/mu],
    ['only-load-asar', /^\s{2}onlyLoadAppFromAsar:\s*true\s*$/mu],
  ];
  const missing = required.filter(([, pattern]) => !pattern.test(source)).map(([name]) => name);
  if (!/^electronFuses:\s*$/mu.test(source)) missing.push('electron-fuses');
  if (missing.length > 0) throw new Error(`Electron builder trust policy missing: ${missing.join(', ')}`);
  return { asar: true, enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true };
}

export function validateReleaseWorkflowTrustPolicy(text) {
  const source = String(text);
  const required = [
    'P6-004 verify packaged Electron fuse wire and app.asar digest',
    'scripts/generate-release-trust-metadata.mjs',
    'scripts/validate-release-trust-metadata.mjs',
    'actions/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a',
    'actions/attest-sbom@4651f806c01d8637787e274ac3bdf724ef169f34',
    'github-build-provenance.sigstore.json',
    'github-sbom.sigstore.json',
    'name: release-trust-metadata',
  ];
  const missing = required.filter((value) => !source.includes(value));
  if (missing.length > 0) throw new Error(`release workflow trust anchors missing: ${missing.join(', ')}`);
  return { portableMetadata: true, buildProvenanceAttestation: true, sbomAttestation: true };
}

export function validateFuseWire(fuseWire, fuseStateEnabled = 49) {
  if (!fuseWire || String(fuseWire.version) !== '1') throw new Error('unsupported Electron fuse wire');
  if (fuseWire[4] !== fuseStateEnabled) throw new Error('EnableEmbeddedAsarIntegrityValidation fuse is disabled');
  if (fuseWire[5] !== fuseStateEnabled) throw new Error('OnlyLoadAppFromAsar fuse is disabled');
  return true;
}

export async function verifyAsarDigest(asarPath, expectedSha256, expectedSize) {
  const data = await readFile(asarPath);
  if (data.length !== expectedSize) throw new Error(`app.asar size mismatch: expected=${expectedSize} actual=${data.length}`);
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== expectedSha256) throw new Error(`app.asar SHA256 mismatch: expected=${expectedSha256} actual=${actual}`);
  return { sha256: actual, size: data.length };
}

function assertExactSubjects(label, expected, actual) {
  const normalize = (items) =>
    [...items]
      .map((item) => ({ name: item.name, size: Number(item.size), sha256: item.sha256 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const normalizedExpected = normalize(expected);
  const normalizedActual = normalize(actual);
  if (new Set(normalizedActual.map((item) => item.name)).size !== normalizedActual.length) {
    throw new Error(`${label} contains duplicate subjects`);
  }
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(`${label} subjects do not match release artifacts`);
  }
}

function assertExactDependencies(expected, actual) {
  const normalize = (items) =>
    [...items]
      .map((item) => ({
        name: item.name,
        version: item.version,
        bomRef: item['bom-ref'],
        purl: item.purl,
        hashes: item.hashes || [],
      }))
      .sort((a, b) => a.bomRef.localeCompare(b.bomRef));
  const normalizedExpected = normalize(expected);
  const normalizedActual = normalize(actual);
  if (new Set(normalizedActual.map((item) => item.bomRef)).size !== normalizedActual.length) {
    throw new Error('SBOM contains duplicate dependency components');
  }
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw new Error('SBOM dependencies do not match pnpm lockfile');
  }
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readJson(filePath) {
  return JSON.parse((await readFile(filePath, 'utf8')).replace(/^\uFEFF/u, ''));
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const builderConfig = readArg('--builder-config');
  const workflow = readArg('--workflow');
  const validation = builderConfig
    ? Promise.all([
        readFile(builderConfig, 'utf8').then(validateElectronBuilderTrustPolicy),
        workflow
          ? readFile(workflow, 'utf8').then(validateReleaseWorkflowTrustPolicy)
          : Promise.resolve(null),
      ]).then(([builder, releaseWorkflow]) => ({ builder, releaseWorkflow }))
    : validateReleaseTrustMetadata({
        artifactsDir: readArg('--artifacts'),
        inventoryPath: readArg('--inventory'),
        sbomPath: readArg('--sbom'),
        provenancePath: readArg('--provenance'),
        lockfilePath: readArg('--lockfile'),
        version: readArg('--version'),
        commit: readArg('--commit'),
        repository: readArg('--repository'),
        ref: readArg('--ref'),
      });
  Promise.resolve(validation)
    .then((result) => console.log(`[release-trust] OK: ${JSON.stringify(result)}`))
    .catch((error) => {
      console.error(`[release-trust] FAIL: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
