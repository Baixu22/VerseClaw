#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256CanonicalEvidenceFile } from './lib/canonical-evidence-hash.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planRoot = path.join(root, 'plans/system-maturity');

function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else if (entry.name.endsWith('.delivery.md')) output.push(absolute);
  }
  return output;
}

let updatedFiles = 0;
let updatedEntries = 0;
for (const deliveryPath of walk(planRoot)) {
  const source = fs.readFileSync(deliveryPath, 'utf8');
  const next = source.replace(/^EVIDENCE:\s*(.+)$/mi, (line, field) => {
    const entries = String(field).split(';').map((entry) => entry.trim()).filter(Boolean);
    const updated = entries.map((entry) => {
      const match = entry.match(/^(.*?)(?:#sha256=[a-f0-9]{64})?$/iu);
      const evidencePath = match?.[1]?.trim();
      if (!evidencePath || evidencePath.includes('*')) return entry;
      const absolute = path.isAbsolute(evidencePath) ? evidencePath : path.join(root, evidencePath);
      if (!fs.existsSync(absolute)) return entry;
      updatedEntries += 1;
      return `${evidencePath}#sha256=${sha256CanonicalEvidenceFile(absolute)}`;
    });
    return `EVIDENCE: ${updated.join('; ')}`;
  });
  if (next !== source) {
    fs.writeFileSync(deliveryPath, next);
    updatedFiles += 1;
  }
}

console.log(`updated maturity delivery hashes: files=${updatedFiles} entries=${updatedEntries}`);
