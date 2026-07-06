import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPABILITY_CLAIM_MATRIX } from '../shared/capability-claims.ts';
import { PRODUCT_SEMANTIC_UNSAFE_CLAIMS } from '../shared/product-semantic-unsafe-claims.ts';

const HIGH_CONFIDENCE_PATTERNS = [
  { id: 'implemented', pattern: /\bimplemented\b/i },
  { id: 'productized', pattern: /\bproducti[sz]ed\b/i },
  { id: 'stable', pattern: /\bstable\b/i },
  { id: 'end-to-end-verified', pattern: /\bend-to-end verified\b/i },
  { id: 'ready-for-all-users', pattern: /\bready for all users\b/i },
  { id: 'zh-implemented', pattern: /已实现/ },
  { id: 'zh-productized', pattern: /已产品化/ },
  { id: 'zh-stable', pattern: /稳定/ },
];

const EVIDENCE_PATTERNS = [
  /shared\/capability-claims\.ts/i,
  /artifacts\/capability-claims\/status-table\.json/i,
  /\bTP-(?:RUN|TEST)\b/i,
  /\bE2E\b/,
  /\bPlaywright\b/i,
  /tests\/e2e\//i,
  /reports\/real-runtime-task-validation-2026-07-04\.md/i,
  /artifacts\/real-runtime-validation\//i,
  /真实运行/,
];

function normalizeText(value) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function lineNumberAt(text, index) {
  if (index < 0) return 1;
  return text.slice(0, index).split(/\r?\n/).length;
}

function hasEvidenceReference(text) {
  return EVIDENCE_PATTERNS.some((pattern) => pattern.test(text));
}

function firstHighConfidenceMatch(text) {
  for (const candidate of HIGH_CONFIDENCE_PATTERNS) {
    const match = candidate.pattern.exec(text);
    if (match?.index !== undefined) {
      return { id: candidate.id, index: match.index, text: match[0] };
    }
  }
  return null;
}

function unsafeOverclaimMatches(text) {
  const normalized = normalizeText(text);
  return CAPABILITY_CLAIM_MATRIX
    .map((entry) => ({
      entry,
      unsafe: normalizeText(entry.claim.unsafe),
    }))
    .filter(({ unsafe }) => unsafe && normalized.includes(unsafe))
    .map(({ entry }) => entry);
}

function productSemanticUnsafeMatches(text) {
  return PRODUCT_SEMANTIC_UNSAFE_CLAIMS.flatMap((claim) => {
    const matches = [];
    for (const pattern of claim.patterns) {
      const match = pattern.exec(text);
      if (match?.index !== undefined) {
        matches.push({ claim, index: match.index, text: match[0] });
      }
    }
    return matches.slice(0, 1);
  });
}

export function analyzeCapabilityClaimText({ filePath, text }) {
  const findings = [];
  const evidencePresent = hasEvidenceReference(text);
  const highConfidence = firstHighConfidenceMatch(text);

  if (highConfidence && !evidencePresent) {
    findings.push({
      code: 'capability.high-confidence-without-evidence',
      severity: 'warning',
      filePath,
      line: lineNumberAt(text, highConfidence.index),
      message: `High-confidence capability phrase "${highConfidence.text}" lacks a claim matrix, E2E, or real-runtime evidence reference.`,
      pattern: highConfidence.id,
    });
  }

  if (!evidencePresent) {
    for (const claim of unsafeOverclaimMatches(text)) {
      const index = normalizeText(text).indexOf(normalizeText(claim.claim.unsafe));
      findings.push({
        code: 'capability.unsafe-overclaim',
        severity: 'warning',
        filePath,
        line: lineNumberAt(text, index),
        message: `Text repeats unsafe claim boundary for ${claim.id}: ${claim.claim.unsafe}`,
        claimId: claim.id,
      });
    }

    for (const match of productSemanticUnsafeMatches(text)) {
      findings.push({
        code: 'capability.product-semantic-unsafe-claim',
        severity: 'warning',
        filePath,
        line: lineNumberAt(text, match.index),
        message: `Text repeats unsafe product semantic claim for ${match.claim.id}: ${match.claim.unsafe}`,
        claimId: match.claim.id,
        safeAlternative: match.claim.safe,
      });
    }
  }

  return findings;
}

async function listMarkdownFiles(target) {
  const resolved = resolve(process.cwd(), target);
  const info = await stat(resolved);
  if (info.isFile()) {
    return resolved.endsWith('.md') ? [resolved] : [];
  }
  if (!info.isDirectory()) {
    return [];
  }
  const entries = await readdir(resolved, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const child = resolve(resolved, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(child));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(child);
    }
  }
  return files;
}

async function analyzeTargets(targets) {
  const files = (await Promise.all(targets.map(listMarkdownFiles))).flat();
  const allFindings = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    allFindings.push(...analyzeCapabilityClaimText({
      filePath: file.replace(/\\/g, '/'),
      text,
    }));
  }
  return allFindings;
}

function printFindings(findings) {
  for (const finding of findings) {
    console.warn(`${finding.severity.toUpperCase()} ${finding.filePath}:${finding.line} ${finding.code} - ${finding.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const failOnWarning = args.includes('--fail-on-warning');
  const json = args.includes('--json');
  const targets = args.filter((arg) => !arg.startsWith('--'));
  const scanTargets = targets.length > 0
    ? targets
    : ['README.md', 'README.zh-CN.md', 'README.ja-JP.md', 'reports'];
  const findings = await analyzeTargets(scanTargets);
  if (json) {
    console.log(JSON.stringify({ findings, count: findings.length }, null, 2));
  } else if (findings.length > 0) {
    printFindings(findings);
  } else {
    console.log('Capability claim check passed with 0 findings.');
  }
  if (failOnWarning && findings.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
