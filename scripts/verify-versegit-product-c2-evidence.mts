#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "harness/specs/fixtures/versegit-product-integration/c2";
const PATHS = {
  links: `${OUT}/observation-links.json`,
  cases: `${OUT}/basis-race-cases.json`,
  coverage: `${OUT}/coverage.json`,
  independent: `${OUT}/independent-review.json`,
  sums: `${OUT}/SHA256SUMS`,
};
function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}
function digest(document: Record<string, any>): string {
  return sha(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined })));
}
function readJson(path: string): Record<string, any> { return JSON.parse(readFileSync(resolve(ROOT, path), "utf8")); }
function leaks(value: unknown): number { return (JSON.stringify(value).match(/[A-Za-z]:[\\/]/gu) ?? []).length; }
function buildReview(generatedAt: string): Record<string, any> {
  const links = readJson(PATHS.links);
  const cases = readJson(PATHS.cases);
  const coverage = readJson(PATHS.coverage);
  const checks: Array<{ id: string; passed: boolean; issues: string[] }> = [];
  const linkIssues: string[] = [];
  if (links.schema !== "clawx.versegit.c2-observation-links/v1") linkIssues.push("link schema mismatch");
  if (links.passed !== true) linkIssues.push("link evidence is not passed");
  if (links.digest !== digest(links)) linkIssues.push("link evidence digest is not reproducible");
  if (leaks(links) > 0) linkIssues.push("link evidence contains an absolute path");
  if (!Array.isArray(links.links) || links.links.length < 4) linkIssues.push("fewer than four observation links");
  for (const link of links.links ?? []) {
    if (typeof link.normalized_event?.path !== "string" || link.normalized_event.path.startsWith("/") || /^[A-Za-z]:/u.test(link.normalized_event.path)) linkIssues.push(`path is not repo-relative: ${String(link.link_id)}`);
    if (!Number.isInteger(link.normalized_event?.line_start) || !Number.isInteger(link.normalized_event?.line_end)) linkIssues.push(`range is missing: ${String(link.link_id)}`);
    if (link.replay?.path_recomputed !== true) linkIssues.push(`path was not recomputed: ${String(link.link_id)}`);
    if (link.replay?.input_digest_well_formed !== true || link.replay?.output_digest_well_formed !== true) linkIssues.push(`digest format is invalid: ${String(link.link_id)}`);
    if (link.normalized_event?.surface === "file.read" && !/^[a-f0-9]{64}$/u.test(link.normalized_event?.basis?.fileSha256 ?? "")) linkIssues.push(`read basis hash is missing: ${String(link.link_id)}`);
    if (link.normalized_event?.surface === "file.write" && !/^[a-f0-9]{64}$/u.test(link.normalized_event?.basis?.afterSha256 ?? "")) linkIssues.push(`write basis hash is missing: ${String(link.link_id)}`);
  }
  checks.push({ id: "observation-links", passed: linkIssues.length === 0, issues: linkIssues });

  const caseIssues: string[] = [];
  if (cases.schema !== "clawx.versegit.c2-basis-race-cases/v1") caseIssues.push("case schema mismatch");
  if (cases.passed !== true) caseIssues.push("case evidence is not passed");
  if (cases.digest !== digest(cases)) caseIssues.push("case evidence digest is not reproducible");
  if (leaks(cases) > 0) caseIssues.push("case evidence contains an absolute path");
  for (const [name, value] of Object.entries(cases.cases ?? {})) {
    if ((value as Record<string, any>)?.passed !== true) caseIssues.push(`case did not pass: ${name}`);
  }
  checks.push({ id: "basis-race-cases", passed: caseIssues.length === 0, issues: caseIssues });

  const coverageIssues: string[] = [];
  if (coverage.schema !== "clawx.versegit.c2-observation-coverage/v1") coverageIssues.push("coverage schema mismatch");
  if (coverage.passed !== true) coverageIssues.push("coverage evidence is not passed");
  if (coverage.digest !== digest(coverage)) coverageIssues.push("coverage evidence digest is not reproducible");
  if (leaks(coverage) > 0) coverageIssues.push("coverage evidence contains an absolute path");
  if (coverage.windows?.["run-a"]?.values?.fileRead !== "direct") coverageIssues.push("file read coverage is not direct");
  if (coverage.windows?.["run-b"]?.values?.fileWrite !== "direct") coverageIssues.push("file write coverage is not direct");
  if (coverage.windows?.["run-a"]?.values?.shellRead !== "unobserved") coverageIssues.push("shell read was incorrectly claimed observed");
  if (coverage.windows?.["run-a"]?.values?.directFs !== "unobserved") coverageIssues.push("direct fs was incorrectly claimed observed");
  if ((coverage.windows?.queue?.droppedCount ?? 0) < 1) coverageIssues.push("bounded queue drop is missing");
  checks.push({ id: "coverage", passed: coverageIssues.length === 0, issues: coverageIssues });

  const passed = checks.every((check) => check.passed);
  return {
    schema: "clawx.versegit.c2-independent-review/v1",
    generated_at: generatedAt,
    task: "TF-0529",
    driven_by: "agent",
    actor: "codex",
    reviewer_role: "independent-c2-verifier-process",
    status: passed ? "passed" : "failed",
    checks,
    evidence_digests: Object.fromEntries([PATHS.links, PATHS.cases, PATHS.coverage].map((path) => [path, sha(readFileSync(resolve(ROOT, path)))])),
    boundaries: {
      real_human_evidence: false,
      default_off: true,
      m4_authorized: false,
      host_authority: "unchanged",
      plaintext_file_contents_retained: false,
    },
    passed,
    digest: "",
  };
}
function sign(document: Record<string, any>): Record<string, any> {
  const next = { ...document };
  delete next.digest;
  next.digest = digest(next);
  return next;
}
function writeSums(): void {
  const paths = [PATHS.links, PATHS.cases, PATHS.coverage, PATHS.independent];
  const body = paths.map((path) => `${sha(readFileSync(resolve(ROOT, path)))}  ${path}`).sort().join("\n");
  writeFileSync(resolve(ROOT, PATHS.sums), `${body}\n`, "utf8");
}
function checkSums(): string[] {
  const issues: string[] = [];
  const expected = new Set([PATHS.links, PATHS.cases, PATHS.coverage, PATHS.independent]);
  const lines = readFileSync(resolve(ROOT, PATHS.sums), "utf8").trim().split(/\r?\n/u).filter(Boolean);
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
    if (!match) { issues.push("malformed SHA256SUMS line"); continue; }
    const [, expectedDigest, path] = match;
    if (!expected.has(path)) { issues.push(`unexpected SHA256SUMS path: ${path}`); continue; }
    expected.delete(path);
    if (sha(readFileSync(resolve(ROOT, path))) !== expectedDigest) issues.push(`SHA256SUMS mismatch: ${path}`);
  }
  if (expected.size > 0) issues.push(`SHA256SUMS missing: ${[...expected].join(", ")}`);
  return issues;
}
function main(): void {
  const checkMode = process.argv.includes("--check");
  if (![PATHS.links, PATHS.cases, PATHS.coverage].every((path) => existsSync(resolve(ROOT, path)))) throw new Error("C2 evidence inputs are incomplete");
  if (checkMode) {
    const review = readJson(PATHS.independent);
    const rebuilt = sign(buildReview(review.generated_at));
    const issues = [
      ...(review.digest === digest(review) ? [] : ["independent review digest is not reproducible"]),
      ...(rebuilt.digest === review.digest ? [] : ["independent review result drifted"]),
      ...checkSums(),
    ];
    if (review.status !== "passed" || review.passed !== true) issues.push("independent review did not pass");
    if (issues.length > 0) throw new Error(issues.join("; "));
    console.log("[versegit-c2-review] CHECK OK");
    return;
  }
  const review = sign(buildReview(new Date().toISOString()));
  writeFileSync(resolve(ROOT, PATHS.independent), `${JSON.stringify(review, null, 2)}\n`, "utf8");
  writeSums();
  if (review.passed !== true) throw new Error(JSON.stringify(review.checks));
  console.log("[versegit-c2-review] WRITE OK");
}
try { main(); } catch (error) { console.error(`[versegit-c2-review] FAIL: ${String((error as Error)?.stack ?? error)}`); process.exitCode = 1; }
