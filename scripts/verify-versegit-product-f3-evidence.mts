#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'harness/specs/fixtures/versegit-product-integration/f3');
const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') ? 'check' : null;
if (!mode) throw new Error('use --write or --check');
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + stable(record[key])).join(',') + '}';
  }
  return JSON.stringify(value);
};
const readJson = (file: string): Record<string, any> => JSON.parse(readFileSync(file, 'utf8'));
function git(args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
}

function inspect() {
  const issues: string[] = [];
  const packageEvidence = readJson(join(OUT, 'sidecar-package-manifest.json'));
  const provenance = readJson(join(OUT, 'build-provenance.json'));
  const negative = readJson(join(OUT, 'package-negative.json'));
  const manifestPath = join(ROOT, 'resources/versegit/manifest.json');
  const manifest = readJson(manifestPath);
  const binaryPath = join(ROOT, manifest.artifact.devPath);
  const licensePath = join(ROOT, manifest.license.path);
  const source = { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']) };
  for (const [name, document] of [['package', packageEvidence], ['provenance', provenance], ['negative', negative]] as const) {
    if (document.driven_by !== 'agent' || document.actor !== 'codex') issues.push(name + ': actor attribution is invalid');
    if (document.clawxSource?.commit !== source.commit || document.clawxSource?.tree !== source.tree) issues.push(name + ': ClawX source identity is stale');
  }
  if (packageEvidence.packageDigest !== sha(stable(packageEvidence.package))) issues.push('embedded package digest mismatch');
  if (sha(stable(manifest)) !== sha(stable(packageEvidence.package))) issues.push('retained manifest differs from package evidence');
  if (packageEvidence.verified?.ok !== true) issues.push('package verifier did not pass');
  if (!existsSync(binaryPath) || sha(readFileSync(binaryPath)) !== manifest.artifact.sha256) issues.push('retained binary hash mismatch');
  if (readFileSync(binaryPath).byteLength !== manifest.artifact.bytes) issues.push('retained binary size mismatch');
  if (!existsSync(licensePath) || sha(readFileSync(licensePath)) !== manifest.license.sha256) issues.push('retained license hash mismatch');
  if (manifest.artifact.platform !== 'win32' || manifest.artifact.arch !== 'x64' || manifest.retention?.supportedTargets?.join(',') !== 'win32-x64') issues.push('supported target inventory is not exact');
  if (manifest.retention?.codeCopied !== false || manifest.retention?.gitDirectoryCopied !== false || manifest.retention?.taskForestCopied !== false || manifest.retention?.privateEvidenceCopied !== false) issues.push('forbidden provider content is retained');
  if (provenance.byteIdentical !== false || provenance.semanticIdentityEqual !== true) issues.push('reproducibility facts are inconsistent');
  if (provenance.reproducibility?.claimable !== false || provenance.reproducibility?.status !== 'semantic-identity-only') issues.push('unachieved byte-identical claim was not recorded honestly');
  if (!Array.isArray(provenance.builds) || provenance.builds.length !== 2 || provenance.builds[0].binarySha256 === provenance.builds[1].binarySha256) issues.push('independent build comparison is incomplete');
  const requiredNegative = ['missing', 'hash_mismatch', 'unsupported_schema', 'unauthorized_profile'];
  for (const id of requiredNegative) if (!negative.cases?.some((entry: any) => entry.id === id && entry.rejected === true)) issues.push('negative case missing: ' + id);
  if (negative.passed !== true) issues.push('negative package suite did not pass');
  if (manifest.profiles?.join(',') !== 'M1') issues.push('authorized profile inventory is not exact');
  const review = {
    schema: 'clawx.versegit.f3-independent-review/v1',
    driven_by: 'agent',
    actor: 'codex',
    reviewedAt: new Date().toISOString(),
    clawxSource: source,
    providerSource: manifest.source,
    verdict: issues.length === 0 ? 'pass' : 'fail',
    priority: { p0: issues.length > 0 ? 1 : 0, p1: 0, p2: 0 },
    issues,
    reproducibility: provenance.reproducibility,
    criteria: [
      { id: 'independent-build-and-consumption-identity', passed: provenance.semanticIdentityEqual === true && packageEvidence.verified?.ok === true, evidence: ['build-provenance.json', 'sidecar-package-manifest.json'] },
      { id: 'byte-identical-claim-honest', passed: provenance.byteIdentical === false && provenance.reproducibility?.claimable === false, evidence: ['build-provenance.json'] },
      { id: 'artifact-negative-resolution', passed: negative.passed === true, evidence: ['package-negative.json'] },
      { id: 'supported-targets-exact', passed: manifest.retention?.supportedTargets?.join(',') === 'win32-x64', evidence: ['sidecar-package-manifest.json'] },
      { id: 'license-provenance-retention', passed: !issues.some((entry) => entry.includes('license') || entry.includes('retained') || entry.includes('forbidden')), evidence: ['sidecar-package-manifest.json', 'build-provenance.json'] },
      { id: 'product-locks-unchanged', passed: provenance.boundaries?.published === false && provenance.boundaries?.defaultOn === false && provenance.boundaries?.liveReady === false && provenance.boundaries?.productApproved === false && provenance.boundaries?.m4Authorized === false, evidence: ['build-provenance.json'] },
    ],
  };
  return { passed: issues.length === 0, issues, review };
}

function writeChecksums(): void {
  const files = readdirSync(OUT).filter((file) => file !== 'SHA256SUMS').sort();
  writeFileSync(join(OUT, 'SHA256SUMS'), files.map((file) => sha(readFileSync(join(OUT, file))) + '  ' + file).join('\n') + '\n', 'utf8');
}

function checkChecksums(): string[] {
  const path = join(OUT, 'SHA256SUMS');
  if (!existsSync(path)) return ['SHA256SUMS is missing'];
  const issues: string[] = [];
  const listed = new Set<string>();
  for (const line of readFileSync(path, 'utf8').trim().split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) { issues.push('malformed checksum line'); continue; }
    listed.add(match[2]!);
    if (!existsSync(join(OUT, match[2]!)) || sha(readFileSync(join(OUT, match[2]!))) !== match[1]) issues.push('checksum mismatch: ' + match[2]);
  }
  for (const file of readdirSync(OUT).filter((entry) => entry !== 'SHA256SUMS')) if (!listed.has(file)) issues.push('unlisted retained file: ' + file);
  return issues;
}

const result = inspect();
if (mode === 'write') {
  writeFileSync(join(OUT, 'independent-review.json'), JSON.stringify(result.review, null, 2) + '\n', 'utf8');
  writeChecksums();
}
const finalIssues = [...result.issues, ...(mode === 'check' ? checkChecksums() : [])];
if (finalIssues.length > 0) {
  console.error(JSON.stringify({ ok: false, issues: finalIssues }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, mode, verdict: result.review.verdict, files: readdirSync(OUT).sort() }, null, 2));
}
