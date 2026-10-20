import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  digestSourceSetContent,
  retrieveSourceSet,
  type SourceSetCandidate,
  type SourceSetSemanticLaneReport,
} from "../openclaw_runtime/src/context-engine/source-set.ts";
import {
  KnowledgeStore,
  RetrievalEngine,
} from "../openclaw_runtime/src/knowledge/sekb/index.ts";
import { closeOpenClawStateDatabase } from "../openclaw_runtime/src/state/openclaw-state-db.ts";
import {
  createSiliconFlowEmbeddingProvider,
} from "../electron/services/knowledge-embedding-provider.ts";
import type { Principle } from "../openclaw_runtime/src/knowledge/sekb/types.ts";

type CohortTask = {
  taskId: string;
  taskIntent: string;
  taskType: string;
  expectedSourceIds: string[];
  sources: Array<{
    id: string;
    title: string;
    content: string;
  }>;
};

type CohortFixture = {
  schema: string;
  drivenBy: string;
  tasks: CohortTask[];
};

type SurfaceResult = {
  surface: "explicit-refs" | "automatic-retrieval" | "sekb-retrieval";
  taskId: string;
  expectedId: string;
  rank: number | null;
  hitAt1: boolean;
  hitAt3: boolean;
  reciprocalRank: number;
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const fixturePath = path.join(repoRoot, "tests/fixtures/knowledge-e4-cohort/real-tasks.json");
const evidenceDir = path.join(repoRoot, "docs/dev/knowledge-system-unification/evidence");
const reportPath = path.join(evidenceDir, "KS-E4-REAL-TASK-COHORTS.json");
const markdownPath = path.join(evidenceDir, "KS-E4-REAL-TASK-COHORTS.md");

function tempRoot(): string {
  if (process.platform === "win32") {
    return path.join("D:", "tmp", "knowledge-e4-cohort");
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-e4-cohort-"));
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function candidateFromSource(source: CohortTask["sources"][number]): SourceSetCandidate {
  return {
    ref: {
      refId: `memory-wiki:${source.id}`,
      owner: "memory-wiki",
      subjectKind: "wiki-page",
      subjectId: source.id,
      revision: "cohort-v1",
      contentDigest: digestSourceSetContent(source.content),
      trust: "confirmed",
      sensitivity: "workspace",
      acl: { read: ["operator"] },
      provenance: {
        sourceRefs: [source.id],
        evidenceRefs: [],
      },
    },
    content: source.content,
    status: "active",
    indexedAt: new Date().toISOString(),
  };
}

function principleFromSource(
  task: CohortTask,
  source: CohortTask["sources"][number],
): Principle {
  const taskType = task.taskType;
  const timestamp = new Date().toISOString();
  return {
    principle_id: `cohort:${task.taskId}:${source.id}`,
    created_at: timestamp,
    updated_at: timestamp,
    title: source.title,
    condition: `When working on ${task.taskType} tasks.`,
    action: source.content,
    reason: "Derived from the real task cohort fixture.",
    full_content: `${source.title}\n${source.content}`,
    task_types: [taskType],
    context_tags: [taskType],
    embedding: null,
    source_trajectories: [],
    created_by: "agent",
    status: "active",
    retrieval_count: 0,
    adoption_count: 0,
    post_adoption_success: 0,
    criticality: "medium",
    pinned: false,
    metadata: {},
  };
}

function rankOf(expectedId: string, rankedIds: string[]): number | null {
  const index = rankedIds.indexOf(expectedId);
  return index >= 0 ? index + 1 : null;
}

function resultFor(
  surface: SurfaceResult["surface"],
  task: CohortTask,
  expectedId: string,
  rankedIds: string[],
): SurfaceResult {
  const rank = rankOf(expectedId, rankedIds);
  return {
    surface,
    taskId: task.taskId,
    expectedId,
    rank,
    hitAt1: rank === 1,
    hitAt3: rank !== null && rank <= 3,
    reciprocalRank: rank === null ? 0 : 1 / rank,
  };
}

function aggregate(results: SurfaceResult[]) {
  const count = results.length;
  return {
    taskCount: count,
    hitAt1: results.filter((result) => result.hitAt1).length / count,
    hitAt3: results.filter((result) => result.hitAt3).length / count,
    meanReciprocalRank: results.reduce((total, result) => total + result.reciprocalRank, 0) / count,
  };
}

async function main(): Promise<void> {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as CohortFixture;
  if (fixture.schema !== "KnowledgeE4RealTaskCohort/v1") {
    throw new Error(`Unsupported cohort schema: ${fixture.schema}`);
  }

  const stateRoot = tempRoot();
  fs.mkdirSync(stateRoot, { recursive: true });
  const stateDir = path.join(stateRoot, "openclaw-state");
  fs.mkdirSync(stateDir, { recursive: true });

  const store = new KnowledgeStore({
    database: {
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: stateDir,
      },
    },
  });
  const retrievalEngine = new RetrievalEngine({ store });
  let cohortSemanticLane: SourceSetSemanticLaneReport = {
    status: "unavailable",
    reason: "cohort-empty",
  };
  const embeddingProvider = process.env.SILICONFLOW_API_KEY
    ? createSiliconFlowEmbeddingProvider()
    : undefined;

  const explicitResults: SurfaceResult[] = [];
  const automaticResults: SurfaceResult[] = [];
  const sekbResults: SurfaceResult[] = [];

  for (const task of fixture.tasks) {
    const candidates = task.sources.map(candidateFromSource);
    const expectedId = task.expectedSourceIds[0];
    if (!expectedId) throw new Error(`Task ${task.taskId} has no expected source`);

    const explicit = await retrieveSourceSet({
      sources: candidates,
      query: {
        text: task.taskIntent,
        pinnedRefs: task.expectedSourceIds.map((id) => ({
          owner: "memory-wiki",
          subjectId: id,
        })),
        aclSubjects: ["operator"],
        limit: 3,
      },
      embeddingProvider,
    });
    explicitResults.push(resultFor("explicit-refs", task, expectedId, explicit.retrieved.map((entry) => entry.ref.subjectId)));

    const automatic = await retrieveSourceSet({
      sources: candidates,
      query: {
        text: task.taskIntent,
        aclSubjects: ["operator"],
        limit: 3,
      },
      embeddingProvider,
    });
    automaticResults.push(resultFor("automatic-retrieval", task, expectedId, automatic.retrieved.map((entry) => entry.ref.subjectId)));
    cohortSemanticLane = automatic.semanticLane;

    for (const source of task.sources) {
      const principleId = `cohort:${task.taskId}:${source.id}`;
      const existing = store.query_principles({ status: "active" }).find((principle) => principle.principle_id === principleId);
      if (!existing) {
        store.save_principle(principleFromSource(task, source));
      }
    }
    const principles = retrievalEngine.retrieve_for_task(task.taskIntent, task.taskType, [task.taskType], 3);
    sekbResults.push(resultFor("sekb-retrieval", task, expectedId, principles.map((principle) => principle.principle_id.replace(`cohort:${task.taskId}:`, ""))));
  }

  const generatedAt = new Date().toISOString();
  const report = {
    schema: "KnowledgeE4RealTaskCohortReport/v1",
    generatedAt,
    drivenBy: "agent",
    evidenceLevel: "E4-agent-driven",
    realProvider: Boolean(process.env.SILICONFLOW_API_KEY),
    semanticLane: cohortSemanticLane,
    cohorts: {
      "explicit-refs": {
        ...aggregate(explicitResults),
        results: explicitResults,
      },
      "automatic-retrieval": {
        ...aggregate(automaticResults),
        results: automaticResults,
      },
      "sekb-retrieval": {
        ...aggregate(sekbResults),
        results: sekbResults,
      },
    },
  };

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  const markdown = [
    "# KS E4 real-task cohort evidence",
    "",
    `- Generated: ${generatedAt}`,
    "- Driven by: agent (no real-human claim)",
    `- Semantic provider: ${report.semanticLane.status}${report.semanticLane.providerId ? ` (${report.semanticLane.providerId})` : ""}`,
    "",
    "## Cohort summary",
    "",
    "| Surface | Tasks | Hit@1 | Hit@3 | MRR |",
    "|---|---:|---:|---:|---:|",
    ...Object.entries(report.cohorts).map(([surface, value]) => (
      `| ${surface} | ${value.taskCount} | ${value.hitAt1.toFixed(3)} | ${value.hitAt3.toFixed(3)} | ${value.meanReciprocalRank.toFixed(3)} |`
    )),
    "",
    "## Per-task results",
    "",
    "| Surface | Task | Expected | Rank | Hit@1 | Hit@3 |",
    "|---|---|---|---:|---:|---:|",
    ...[...explicitResults, ...automaticResults, ...sekbResults].map((result) => (
      `| ${result.surface} | ${result.taskId} | ${result.expectedId} | ${result.rank ?? "miss"} | ${result.hitAt1 ? "yes" : "no"} | ${result.hitAt3 ? "yes" : "no"} |`
    )),
    "",
    "Boundary: this is an agent-driven real-task cohort built from repository task records. It does not claim real-human usefulness, E5 soak, product approval, or default-on promotion.",
    "",
    "## Reproduction",
    "",
    "Run `SILICONFLOW_API_KEY=<redacted> pnpm --dir openclaw_runtime exec node --import tsx ../scripts/knowledge-e4-cohort.mts`. The key must come from the caller environment and is never written to this report.",
    "",
  ].join("\n");
  fs.writeFileSync(markdownPath, markdown, "utf8");

  closeOpenClawStateDatabase();
  try {
    fs.rmSync(stateRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  } catch (error) {
    console.warn(`[knowledge-e4-cohort] Temporary state cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await main();
