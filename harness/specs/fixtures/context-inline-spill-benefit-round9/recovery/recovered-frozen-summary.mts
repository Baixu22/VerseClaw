import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {mcnemarExact,parseAnswer,wilson} from "file:///D:/tmp/g7-closeout-pass-r7-01a1d34c/validation-checkout/scripts/context-inline-spill-benefit-scoring.mts";
const ROOT=process.cwd(),MODE='live',RUN_ID="2026-11-13T11-48-49-227Z-live",runDir="D:\\tmp\\g7-closeout-pass-r9-01a1d34c\\recovered\\2026-11-13T11-48-49-224Z-live-2026-11-13T12-46-29-966Z";
const ACTOR="codex-g7-inline-spill-tf0749-01a1d34c",MODEL='space-bunny',BASE_URL='http://127.0.0.1:3065/v1',REPEATS=3,MAX_TURNS=8,MAX_OUTPUT_TOKENS=900,STRATEGY='bookmarked',PRESSURE_SOURCE='tool',PROVIDER_TIMEOUT_MS=240000,DETERMINISTIC_FAULT='none';
const CONTEXT_WINDOW_TOKENS=32000,TOOL_MAX_CHARS=6000,AGGREGATE_MAX_CHARS=16000,RECALL_PAGE_CHARS=5500,ARCHIVE_RECALL_RETENTION_MAX_CHARS=16000;
const API_KEY=process.env.LOCAL3065_API_KEY,pre=JSON.parse(readFileSync(join(runDir,'preflight.json'),'utf8')),candidateAtStart=pre.candidate,sourceInputs=pre.sourceInputs,designFreeze=pre.designFreeze,freezePath=pre.designFreeze.path;
const recovery=JSON.parse(readFileSync(join(runDir,'recovery-provenance.json'),'utf8'));
function digest(value){return createHash('sha256').update(value).digest('hex')}
function redact(value){return API_KEY?value.split(API_KEY).join('[redacted]'):value}
function save(name,value){if(name==='postflight.json')value={...value,schema:'ContextInlineSpillRecoveredPostflight/v1',recovery};else value={...value,recovery};writeFileSync(join(runDir,name),redact(JSON.stringify(value,null,2))+'\n')}
const ARMS=['baseline-no-reference','reference-visible','recall-stable','retention-off'];
const ARM_CONFIG={'baseline-no-reference':{reference:false,retention:false,pressure:false},'reference-visible':{reference:true,retention:false,pressure:false},'recall-stable':{reference:true,retention:true,pressure:true},'retention-off':{reference:true,retention:false,pressure:true}};
const records=readFileSync(join(runDir,'runs.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line).record);
// ---------------------------------------------------------------- fixtures
type Fixture = { id: string; question: string; oracle: string | null; payload: string };
const FILLER = "The deployment log records routine health checks for this workstation. ".repeat(4);

function buildFixtures(): Fixture[] {
  const evidence = [
    { id: "deploy-token", oracle: "DEPLOY_TOKEN_7f31ab", question: "What exact deploy token is recorded in the archived tool output? Answer with the exact token." },
    { id: "db-passport", oracle: "DB_PASSPORT_9c02de", question: "What exact database passport string is recorded in the archived tool output?" },
    { id: "cache-seed", oracle: "CACHE_SEED_44aa10", question: "What exact cache seed is recorded in the archived tool output?" },
    { id: "signing-key", oracle: "SIGNING_KEY_b71c55", question: "What exact signing key identifier is recorded in the archived tool output?" },
    { id: "tenant-id", oracle: "TENANT_ID_3d9e77", question: "What exact tenant id is recorded in the archived tool output?" },
    { id: "migration-hash", oracle: "MIGRATION_HASH_a1f4c8", question: "What exact migration hash is recorded in the archived tool output?" },
  ];
  const controls = [
    { id: "control-absent-1", question: "What exact deploy token is recorded in the archived tool output? If no such exact value exists, answer null." },
    { id: "control-absent-2", question: "What exact tenant id is recorded in the archived tool output? If no such exact value exists, answer null." },
  ];
  const fixtures: Fixture[] = [];
  let i = 0;
  for (const item of evidence) {
    // Positions 7000/8000/9000 are outside the initial truncated head and in
    // the second 5500-character recall page. Aggregate pressure trims that
    // evidence from a page when bounded recall retention is disabled.
    const offset = [7_000, 8_000, 9_000][i++ % 3]!;
    const before = FILLER.repeat(Math.ceil(offset / FILLER.length)).slice(0, offset);
    const payload = before + "private_evidence=" + item.oracle + "\n" + FILLER.repeat(120) + "summary: completed checks\n";
    fixtures.push({ id: item.id, question: item.question, oracle: item.oracle, payload });
  }
  for (const item of controls) {
    fixtures.push({ id: item.id, question: item.question, oracle: null, payload: FILLER.repeat(160) + "summary: completed checks\n" });
  }
  return fixtures;
}


const fixtures=buildFixtures();
// ---------------------------------------------------------------- summary
const evidenceTasks = fixtures.filter((f) => f.oracle !== null).map((f) => f.id);
const controlTasks = fixtures.filter((f) => f.oracle === null).map((f) => f.id);

function armStats(arm: Arm) {
  const rows = records.filter((r) => r.arm === arm);
  const n = rows.length;
  const evidenceRows = rows.filter((r) => evidenceTasks.includes(r.fixtureId));
  const controlRows = rows.filter((r) => controlTasks.includes(r.fixtureId));
  const pass = rows.filter((r) => r.success).length;
  const mean = (pick: (r: RunRecord) => number) => (n ? rows.reduce((s, r) => s + pick(r), 0) / n : 0);
  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const pct = (q: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(q * (latencies.length - 1)))] : 0);
  const passK = evidenceTasks.filter((id) => rows.filter((r) => r.fixtureId === id).every((r) => r.success) && rows.some((r) => r.fixtureId === id)).length / Math.max(1, evidenceTasks.length);
  return {
    arm, runs: n, pass,
    successRate: n ? pass / n : 0,
    wilson95: wilson(pass, n),
    evidenceSuccessRate: evidenceRows.length ? evidenceRows.filter((r) => r.success).length / evidenceRows.length : 0,
    controlSuccessRate: controlRows.length ? controlRows.filter((r) => r.success).length / controlRows.length : 0,
    passAtK: passK,
    recallAttemptRate: evidenceRows.length ? evidenceRows.filter((r) => r.recallAttempted).length / evidenceRows.length : 0,
    recallOkRate: evidenceRows.length ? evidenceRows.filter((r) => r.recallOk).length / evidenceRows.length : 0,
    meanTurns: mean((r) => r.turns),
    meanMainContextChars: mean((r) => r.mainContextChars),
    meanInputTokens: mean((r) => r.inputTokens),
    meanOutputTokens: mean((r) => r.outputTokens),
    meanTotalTokens: mean((r) => r.totalTokens),
    p50LatencyMs: pct(0.5), p95LatencyMs: pct(0.95),
    failureClasses: rows.reduce<Record<string, number>>((acc, r) => { const k = r.failureClass ?? "none"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
  };
}

const stats = Object.fromEntries(ARMS.map((a) => [a, armStats(a)])) as Record<Arm, ReturnType<typeof armStats>>;
const initialPairs = records.filter((r) => r.arm === "recall-stable").map((r) => {
  const off = records.find((o) => o.arm === "retention-off" && o.fixtureId === r.fixtureId && o.repetition === r.repetition)!;
  return { fixtureId: r.fixtureId, repetition: r.repetition, stableSha256: r.initialRequestSha256, offSha256: off.initialRequestSha256, byteIdentical: r.initialRequestSha256 === off.initialRequestSha256 };
});

function paired(a: Arm, b: Arm, evidenceOnly = false) {
  let both = 0, onlyA = 0, onlyB = 0, neither = 0;
  for (const fixture of new Set(records.map((r) => r.fixtureId))) {
    if (evidenceOnly && !evidenceTasks.includes(fixture)) continue;
    for (let rep = 0; rep < REPEATS; rep++) {
      const ra = records.find((r) => r.arm === a && r.fixtureId === fixture && r.repetition === rep);
      const rb = records.find((r) => r.arm === b && r.fixtureId === fixture && r.repetition === rep);
      if (!ra || !rb) continue;
      if (ra.success && rb.success) both++;
      else if (ra.success) onlyA++;
      else if (rb.success) onlyB++;
      else neither++;
    }
  }
  return { both, onlyA, onlyB, neither, p: mcnemarExact(onlyA, onlyB) };
}

const comparisons = {
  "recall-stable_vs_baseline": paired("recall-stable", "baseline-no-reference"),
  "recall-stable_vs_retention-off": paired("recall-stable", "retention-off"),
  "recall-stable_vs_reference-visible": paired("recall-stable", "reference-visible"),
};
const evidenceComparisons = {
  "recall-stable_vs_baseline": paired("recall-stable", "baseline-no-reference", true),
  "recall-stable_vs_retention-off": paired("recall-stable", "retention-off", true),
  "recall-stable_vs_reference-visible": paired("recall-stable", "reference-visible", true),
};

const controlPass = records.filter((r) => r.arm === "recall-stable" && controlTasks.includes(r.fixtureId)).every((r) => r.success);
const b1 = stats["recall-stable"].recallAttemptRate >= 0.8 && stats["recall-stable"].recallOkRate >= 0.95;
const b2 = stats["recall-stable"].evidenceSuccessRate - stats["baseline-no-reference"].evidenceSuccessRate >= 0.3 && evidenceComparisons["recall-stable_vs_baseline"].p < 0.05;
const b3 = stats["recall-stable"].evidenceSuccessRate > stats["retention-off"].evidenceSuccessRate && evidenceComparisons["recall-stable_vs_retention-off"].onlyA >= 1 && evidenceComparisons["recall-stable_vs_retention-off"].onlyB === 0;
const b4 = stats["recall-stable"].evidenceSuccessRate >= stats["reference-visible"].evidenceSuccessRate - 0.05;
const b5 = controlPass;
const contextGrowth = stats["recall-stable"].meanMainContextChars - stats["retention-off"].meanMainContextChars;
const tokenGrowthPct = stats["reference-visible"].meanTotalTokens > 0
  ? (stats["recall-stable"].meanTotalTokens - stats["reference-visible"].meanTotalTokens) / stats["reference-visible"].meanTotalTokens
  : 0;
const b6 = contextGrowth <= ARCHIVE_RECALL_RETENTION_MAX_CHARS && tokenGrowthPct <= 0.25;
const decisionStatus = MODE !== "live"
  ? "inconclusive"
  : b1 && b2 && b3 && b4 && b5 && b6 ? "inconclusive"
  : b1 ? "mechanism-only"
  : stats["recall-stable"].runs >= 18 ? "no-benefit" : "inconclusive";

const result = {
  schema: "ContextInlineSpillBenefitLoopEval/v1",
  runId: RUN_ID,
  mode: MODE,
  driven_by: "agent",
  actor: ACTOR,
  realHumanEvidence: false,
  loop_driver: "eval-harness (executes only the model-returned tool calls)",
  candidate: candidateAtStart,
  designFreeze,
  provider: MODE === "live"
    ? { kind: "openai-compatible-responses", endpoint_origin: new URL(BASE_URL).origin, model: MODEL, credential_persisted: false }
    : { kind: "deterministic-scripted-policy", endpoint_origin: null, model: null, credential_persisted: false },
  design: { repeats: REPEATS, maxTurns: MAX_TURNS, maxOutputTokens: MAX_OUTPUT_TOKENS, reasoning: { effort: "low", summary: "auto" },
    strategy: STRATEGY, pressureSource: PRESSURE_SOURCE, providerTimeoutMs: PROVIDER_TIMEOUT_MS, deterministicFault: DETERMINISTIC_FAULT,
    evidenceTasks, controlTasks, arms: ARM_CONFIG, contextWindowTokens: CONTEXT_WINDOW_TOKENS, toolMaxChars: TOOL_MAX_CHARS, aggregateMaxChars: AGGREGATE_MAX_CHARS, recallPageChars: RECALL_PAGE_CHARS },
  stats, comparisons, evidenceComparisons,
  inputIntegrity: { assembly: "production-projection-only/function-protocol/r5-low-reasoning", mainContextCharsSource: "JSON.stringify(actual request.input).length", initialPairs, allInitialPairsByteIdentical: initialPairs.every((p) => p.byteIdentical), unprojectedOutputFallback: false },
  decision: {
    status: decisionStatus,
    b1_mechanism_and_autonomy: b1,
    b2_task_benefit: b2,
    b3_retention_benefit: b3,
    b4_non_inferiority: b4,
    b5_no_fabrication: b5,
    b6_budget: b6,
    contextGrowthChars: contextGrowth,
    tokenGrowthPct,
    engineeringAcceptedByAgent: false, releaseApproved: false, liveReady: false, defaultOn: false,
  },
  boundaries: [
    "The loop driver is an eval harness: it executes only the tool calls the model returns, but it is not the Electron/Gateway product turn (no gateway approval, system prompt or bootstrap).",
    "Deterministic mode uses a scripted policy and is harness self-test only, never evidence of model autonomy.",
    "Cost is not-run unless the provider returns a billing unit; token usage is recorded per call.",
    "Results cover this corpus and this model only; they do not establish product quality or GA.",
  ],
};

function execGit(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
}
function candidateIdentity() {
  const status = execGit(["status", "--porcelain=v1"]);
  return { commit: execGit(["rev-parse", "HEAD"]), tree: execGit(["rev-parse", "HEAD^{tree}"]),
    branch: execGit(["branch", "--show-current"]), dirty: status.length > 0, status };
}
function sourceIdentities(paths: string[]): Record<string, SourceIdentity> {
  return Object.fromEntries(paths.map((path) => {
    const bytes = readFileSync(resolve(ROOT, path));
    return [path, { sha256: digest(bytes), bytes: bytes.length,
      gitBlob: execGit(["rev-parse", "HEAD:" + path]), worktreeBlob: execGit(["hash-object", "--no-filters", path]) }];
  }));
}

const candidateAtEnd = candidateIdentity();
const sourcesAtEnd = freezePath ? sourceIdentities(Object.keys(sourceInputs)) : {};
save("postflight.json", { schema: "ContextInlineSpillPostflight/v1", driven_by: "agent", actor: ACTOR,
  realHumanEvidence: false, finishedAt: new Date().toISOString(), candidate: candidateAtEnd,
  sourceInputs: sourcesAtEnd, sameCandidate: !candidateAtStart.dirty && !candidateAtEnd.dirty &&
    candidateAtStart.commit === candidateAtEnd.commit && candidateAtStart.tree === candidateAtEnd.tree &&
    JSON.stringify(sourceInputs) === JSON.stringify(sourcesAtEnd) });

save("result.json", result);
save("runs.json", { schema: "ContextInlineSpillBenefitRuns/v1", driven_by: "agent", actor: ACTOR, realHumanEvidence: false, records });
const files = ["result.json", "runs.json"];
const credentialHits = files.reduce((sum, name) => {
  const text = readFileSync(join(runDir, name), "utf8");
  return sum + Number(Boolean(API_KEY && text.includes(API_KEY))) + (text.match(/\bsk-[A-Za-z0-9_-]{16,}\b/g)?.length ?? 0);
}, 0);
save("credential-scan.json", { schema: "ContextInlineSpillBenefitCredentialScan/v1", driven_by: "agent", actor: ACTOR, realHumanEvidence: false, files_scanned: files.length, hits: credentialHits, passed: credentialHits === 0 });
files.push("credential-scan.json");
writeFileSync(join(runDir, "SHA256SUMS"), files.map((n) => digest(readFileSync(join(runDir, n))) + "  " + n).join("\n") + "\n");
console.log(JSON.stringify({ runDir, mode: MODE, decision: result.decision, stats: Object.fromEntries(ARMS.map((a) => [a, { evidenceSuccessRate: stats[a].evidenceSuccessRate, controlSuccessRate: stats[a].controlSuccessRate, recallAttemptRate: stats[a].recallAttemptRate, meanMainContextChars: stats[a].meanMainContextChars, meanTotalTokens: stats[a].meanTotalTokens, p95LatencyMs: stats[a].p95LatencyMs }])), credentialHits }, null, 2));
process.exitCode = credentialHits === 0 && result.inputIntegrity.allInitialPairsByteIdentical && (MODE === "deterministic" || result.decision.status !== "inconclusive" || (b1 && b2 && b3 && b4 && b5 && b6)) ? 0 : 1;


