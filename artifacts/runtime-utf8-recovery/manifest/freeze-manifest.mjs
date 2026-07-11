import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function sourceSpanIdentity(span) {
  return [
    span.currentOffset,
    span.removeHex,
    span.insertHex,
    span.leftAnchorHex,
    span.rightAnchorHex,
  ].join(":");
}

function packageOwner(repositoryPath) {
  const parts = repositoryPath.split("/");
  if (parts[0] !== "openclaw_runtime" || parts[1] !== "extensions" || !parts[2]) {
    throw new Error(`repair file has no extension package owner: ${repositoryPath}`);
  }
  return parts.slice(0, 3).join("/");
}

function requireCompleteReport(report) {
  if (
    report?.schemaVersion !== 2 ||
    report.spanModel !== "source-aligned-variable-length" ||
    !Array.isArray(report.files) ||
    !Array.isArray(report.records)
  ) {
    throw new Error("invalid source-span evidence report");
  }
  const blocked =
    Number(report.counts?.candidate ?? 0) +
    Number(report.counts?.conflict ?? 0) +
    Number(report.counts?.unresolved ?? 0);
  if (blocked !== 0) {
    throw new Error(`cannot freeze non-applicable evidence: blocked=${blocked}`);
  }
  if (
    report.records.some(
      (record) =>
        (record.status !== "exact" && record.status !== "corroborated") ||
        !record.selectedSpan,
    )
  ) {
    throw new Error("cannot freeze non-applicable evidence records");
  }
  if (
    report.files.some(
      (file) =>
        !file.applicable ||
        !file.postimageStrictUtf8 ||
        !/^[0-9a-f]{64}$/i.test(file.preimageSha256) ||
        !/^[0-9a-f]{64}$/i.test(file.expectedPostimageSha256),
    )
  ) {
    throw new Error("cannot freeze incomplete file evidence");
  }
}

export function buildFrozenManifest(report) {
  requireCompleteReport(report);
  const fileEvidence = new Map(report.files.map((file) => [file.path, file]));
  const recordsByFile = new Map();
  for (const record of report.records) {
    if (!fileEvidence.has(record.path)) {
      throw new Error(`record has no file evidence: ${record.id}`);
    }
    if (!recordsByFile.has(record.path)) {
      recordsByFile.set(record.path, []);
    }
    recordsByFile.get(record.path).push(record);
  }
  if (recordsByFile.size !== fileEvidence.size) {
    throw new Error("file evidence contains a path with no recovery records");
  }

  const repairs = [];
  const fileGroups = [];
  for (const file of [...report.files].toSorted((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const spanRecords = new Map();
    for (const record of recordsByFile.get(file.path)) {
      const span = record.selectedSpan;
      if (!spanRecords.has(span.spanId)) {
        spanRecords.set(span.spanId, []);
      }
      spanRecords.get(span.spanId).push(record);
    }

    const replacements = [];
    for (const [spanId, records] of spanRecords) {
      const selected = records[0].selectedSpan;
      if (
        records.some(
          (record) => sourceSpanIdentity(record.selectedSpan) !== sourceSpanIdentity(selected),
        )
      ) {
        throw new Error(`inventory records disagree on merged span: ${spanId}`);
      }
      const evidenceIds = new Set();
      const inventoryRecordIds = new Set();
      for (const record of records) {
        inventoryRecordIds.add(record.id);
        for (const candidate of record.candidates ?? []) {
          evidenceIds.add(candidate.sourceId);
        }
        for (const evidence of record.corroboratingEvidence ?? []) {
          evidenceIds.add(evidence.id);
        }
      }
      if (evidenceIds.size === 0) {
        throw new Error(`source span has no evidence IDs: ${spanId}`);
      }
      replacements.push({
        spanId,
        currentOffset: selected.currentOffset,
        removeHex: selected.removeHex,
        insertHex: selected.insertHex,
        leftAnchorHex: selected.leftAnchorHex,
        rightAnchorHex: selected.rightAnchorHex,
        inventoryRecordIds: [...inventoryRecordIds].sort(),
        evidenceIds: [...evidenceIds].sort(),
      });
    }
    replacements.sort((left, right) => left.currentOffset - right.currentOffset);
    for (let index = 1; index < replacements.length; index += 1) {
      const previous = replacements[index - 1];
      const previousEnd =
        previous.currentOffset + Buffer.from(previous.removeHex, "hex").length;
      if (replacements[index].currentOffset < previousEnd) {
        throw new Error(`frozen source spans overlap: ${file.path}`);
      }
    }

    repairs.push({
      path: file.path,
      preimageSha256: file.preimageSha256.toLowerCase(),
      expectedPostimageSha256: file.expectedPostimageSha256.toLowerCase(),
      confidence: "corroborated",
      replacements,
    });

    fileGroups.push({
      owner: packageOwner(file.path),
      path: file.path,
      spanCount: replacements.length,
      inventoryRecordCount: recordsByFile.get(file.path).length,
    });
  }

  const partitions = ["a", "b", "c", "d"].map((id) => ({
    id,
    paths: [],
    packages: [],
    spanCount: 0,
    inventoryRecordCount: 0,
  }));
  const orderedGroups = fileGroups.toSorted(
    (left, right) =>
      right.spanCount - left.spanCount ||
      left.path.localeCompare(right.path),
  );
  for (const group of orderedGroups) {
    const partition = partitions.toSorted(
      (left, right) =>
        left.spanCount - right.spanCount ||
        left.paths.length - right.paths.length ||
        left.id.localeCompare(right.id),
    )[0];
    partition.packages.push(group.owner);
    partition.paths.push(group.path);
    partition.spanCount += group.spanCount;
    partition.inventoryRecordCount += group.inventoryRecordCount;
  }
  for (const partition of partitions) {
    partition.packages = [...new Set(partition.packages)].sort();
    partition.paths.sort();
    partition.fileCount = partition.paths.length;
  }

  const allPaths = partitions.flatMap((partition) => partition.paths);
  if (
    allPaths.length !== repairs.length ||
    new Set(allPaths).size !== repairs.length ||
    repairs.some((repair) => !allPaths.includes(repair.path))
  ) {
    throw new Error("repair partitions are not a pairwise-disjoint complete cover");
  }

  return {
    manifest: {
      schemaVersion: 2,
      spanModel: "source-aligned-variable-length",
      summary: {
        files: repairs.length,
        uniqueSpans: repairs.reduce((total, repair) => total + repair.replacements.length, 0),
        inventoryRecords: report.records.length,
        unresolved: 0,
      },
      repairs,
    },
    partitions,
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`invalid argument: ${name}`);
    }
    options[name.slice(2)] = argv[++index];
  }
  for (const required of ["report", "output", "allowlists-dir", "partition-map"]) {
    if (!options[required]) {
      throw new Error(`--${required} is required`);
    }
  }
  return options;
}

function writeJson(outputPath, value) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const reportBytes = fs.readFileSync(path.resolve(options.report));
  const report = JSON.parse(reportBytes.toString("utf8"));
  const frozen = buildFrozenManifest(report);
  frozen.manifest.sourceEvidence = {
    path: options.report.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(reportBytes).digest("hex"),
  };
  writeJson(path.resolve(options.output), frozen.manifest);
  writeJson(path.resolve(options["partition-map"]), {
    schemaVersion: 1,
    manifestPath: options.output.replaceAll("\\", "/"),
    partitions: frozen.partitions,
  });
  const allowlistsDirectory = path.resolve(options["allowlists-dir"]);
  fs.mkdirSync(allowlistsDirectory, { recursive: true });
  for (const partition of frozen.partitions) {
    fs.writeFileSync(
      path.join(allowlistsDirectory, `partition-${partition.id}.txt`),
      `${partition.paths.join("\n")}\n`,
      "utf8",
    );
  }
  console.log(
    `files=${frozen.manifest.summary.files} spans=${frozen.manifest.summary.uniqueSpans} records=${frozen.manifest.summary.inventoryRecords}`,
  );
  for (const partition of frozen.partitions) {
    console.log(
      `partition=${partition.id} packages=${partition.packages.length} files=${partition.fileCount} spans=${partition.spanCount}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
