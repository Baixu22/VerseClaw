/**
 * Validate a DCS corpus JSON file against the evidence-factory schema.
 * Usage: node --import tsx scripts/dcs-corpus-validate.mts [path]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../src/context-engine/dcs-corpus-schema.ts";

const repoRuntime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultPath = path.join(
  repoRuntime,
  "src/context-engine/fixtures/dcs-corpus-minimal.json",
);

function main(): void {
  const target = path.resolve(process.argv[2] ?? defaultPath);
  const doc = loadCorpus(target);
  console.log(
    JSON.stringify(
      {
        ok: true,
        path: target,
        kind: doc.kind,
        source: doc.source,
        entryCount: doc.entries.length,
        seed: doc.seed ?? null,
      },
      null,
      2,
    ),
  );
}

main();