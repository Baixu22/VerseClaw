import fs from "node:fs";
import path from "node:path";
import { collectExplicitTestFileArgs } from "./run-vitest.mjs";

const canonical = (file) => fs.realpathSync(file).replaceAll("\\", "/");

/** @param {string[]} requested @param {readonly { moduleId: string, project?: { config: { dir?: string, root: string } } }[]} selected */
export function assertExplicitTargetsSelected(requested, selected) {
  const missing = requested.filter((file) => !selected.some((spec) => {
    const base = spec.project?.config.dir ?? spec.project?.config.root ?? process.cwd();
    const target = fs.existsSync(file) ? file : path.resolve(base, file);
    return fs.existsSync(target) && canonical(target) === canonical(spec.moduleId);
  }));
  if (missing.length > 0) {
    throw new Error(`[vitest] requested test file(s) not selected:\n${missing.join("\n")}`);
  }
}

/** Resolve the actual project matrix without executing tests or replacing reporters. */
export async function validateExplicitTestTargets(argv) {
  const { createVitest, parseCLI } = await import("vitest/node");
  const { filter, options } = parseCLI(["vitest", ...argv]);
  // Match the pinned Vitest 4 CLI's normalization before using its public API.
  if (options.exclude) {
    options.cliExclude = Array.isArray(options.exclude) ? options.exclude : [options.exclude];
    delete options.exclude;
  }
  if (filter.some((value) => value.includes(":"))) options.includeTaskLocation ??= true;
  if (typeof options.typecheck?.only === "boolean") options.typecheck.enabled ??= true;
  if (options.run || options.clearCache || options.listTags) options.watch = false;
  if (options.standalone && filter.length > 0) options.standalone = false;
  process.env.TEST = "true";
  process.env.VITEST = "true";
  process.env.NODE_ENV ??= "test";
  const ctx = await createVitest("test", options);
  try {
    if (!ctx.config.watch) {
      assertExplicitTargetsSelected(collectExplicitTestFileArgs(argv), await ctx.getRelevantTestSpecifications(filter));
    }
  } finally {
    await ctx.close();
  }
}

if (import.meta.main) {
  await validateExplicitTestTargets(process.argv.slice(2));
}
