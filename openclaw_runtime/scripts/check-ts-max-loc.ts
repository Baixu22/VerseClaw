// Check Ts Max Loc script supports OpenClaw repository automation.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

function writeStdoutLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

type ParsedArgs = {
  maxLines: number;
  baselinePath?: string;
};

type BaselineFile = {
  version: number;
  maxLines: number;
  entries: Record<string, number>;
};

function parseArgs(argv: string[]): ParsedArgs {
  let maxLines = 500;
  let baselinePath: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--max") {
      const next = argv[index + 1];
      if (!next || Number.isNaN(Number(next))) {
        throw new Error("Missing/invalid --max value");
      }
      maxLines = Number(next);
      index++;
      continue;
    }
    if (arg === "--baseline") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("Missing --baseline value");
      }
      baselinePath = next;
      index++;
      continue;
    }
  }

  return { maxLines, baselinePath };
}

function gitLsFilesAll(): string[] {
  // Include untracked files too so local refactors don’t “pass” by accident.
  const stdout = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function countLines(filePath: string): Promise<number> {
  const content = await readFile(filePath, "utf8");
  // Count physical lines. Keeps the rule simple + predictable.
  return content.split("\n").length;
}

// TF-0092: reading every tracked .ts/.tsx file with an unbounded Promise.all
// exhausted file descriptors on large checkouts (EMFILE) before the gate could
// report anything. Keep the scan bounded; the verdict semantics are unchanged.
const LOC_SCAN_CONCURRENCY = 64;

async function countLinesBatched(
  filePaths: string[],
): Promise<Array<{ filePath: string; lines: number }>> {
  const results: Array<{ filePath: string; lines: number }> = [];
  for (let start = 0; start < filePaths.length; start += LOC_SCAN_CONCURRENCY) {
    const batch = filePaths.slice(start, start + LOC_SCAN_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (filePath) => ({ filePath, lines: await countLines(filePath) })),
    );
    results.push(...batchResults);
  }
  return results;
}

async function loadBaseline(baselinePath: string, maxLines: number): Promise<BaselineFile> {
  const resolvedPath = path.resolve(process.cwd(), baselinePath);
  const baseline = JSON.parse(await readFile(resolvedPath, "utf8")) as BaselineFile;
  if (baseline.maxLines !== maxLines) {
    throw new Error(`Baseline maxLines ${baseline.maxLines} does not match --max ${maxLines}`);
  }
  if (!baseline.entries || typeof baseline.entries !== "object") {
    throw new Error("Baseline entries must be an object keyed by file path");
  }
  return baseline;
}

async function main() {
  // Makes `... | head` safe.
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0);
    }
    throw error;
  });

  const { maxLines, baselinePath } = parseArgs(process.argv.slice(2));
  const files = gitLsFilesAll()
    .filter((filePath) => existsSync(filePath))
    .filter((filePath) => filePath.endsWith(".ts") || filePath.endsWith(".tsx"));

  const results = await countLinesBatched(files);

  const offenders = results
    .filter((result) => result.lines > maxLines)
    .toSorted((a, b) => b.lines - a.lines);

  if (!baselinePath) {
    if (!offenders.length) return;
    for (const offender of offenders) {
      writeStdoutLine(`${offender.lines}\t${offender.filePath}`);
    }
    process.exitCode = 1;
    return;
  }

  const baseline = await loadBaseline(baselinePath, maxLines);
  const actualPaths = new Set(offenders.map((entry) => entry.filePath));
  const newOffenders = offenders.filter((entry) => !(entry.filePath in baseline.entries));
  const grown = offenders.filter(
    (entry) => entry.filePath in baseline.entries && entry.lines > baseline.entries[entry.filePath],
  );
  const improved = offenders.filter(
    (entry) => entry.filePath in baseline.entries && entry.lines < baseline.entries[entry.filePath],
  );
  const removed = Object.keys(baseline.entries).filter((filePath) => !actualPaths.has(filePath));

  if (newOffenders.length > 0) {
    writeStdoutLine(`New files over ${maxLines} lines (${newOffenders.length}):`);
    for (const entry of newOffenders) writeStdoutLine(`NEW\t${entry.lines}\t${entry.filePath}`);
  }
  if (grown.length > 0) {
    writeStdoutLine(`Existing baseline files that grew (${grown.length}):`);
    for (const entry of grown) {
      writeStdoutLine(
        `GROWN\t${baseline.entries[entry.filePath]}->${entry.lines}\t${entry.filePath}`,
      );
    }
  }
  if (newOffenders.length > 0 || grown.length > 0) {
    process.exitCode = 1;
    return;
  }

  writeStdoutLine(
    `LOC baseline passed: ${offenders.length} offenders tracked, ` +
      `${improved.length} improved, ${removed.length} removed from the baseline.`,
  );
}

await main();
