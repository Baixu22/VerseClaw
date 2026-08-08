import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { parseFrontmatter } from '../../harness/src/specs.mjs';
import { digestReport } from '../../scripts/lib/agent-engineering-acceptance.mjs';

const packRoot = 'docs/dev/unified-agent-system/runtime-convergence';

function read(relativePath: string): string {
  return readFileSync(`${packRoot}/${relativePath}`, 'utf8');
}

type EvidenceManifest = {
  schema?: string;
  manifestVersion?: number;
  runId?: string;
  executionMode?: string;
  manifestDigest?: string;
  baseRef?: string;
  changedPaths?: string[];
  candidate?: { commit?: string; tree?: string; cleanAtPlan?: boolean };
  task?: { humanEvidence?: string };
  safety?: { humanEvidence?: string };
};

type EngineeringReport = {
  schema?: string;
  documentType?: string;
  reportVersion?: number;
  runId?: string;
  role?: string;
  actor?: string;
  result?: string;
  engineeringAcceptedByAgent?: boolean;
  humanEvidenceRequired?: boolean;
  taskStatusRecommendation?: string;
  executorActor?: string;
  verifierActor?: string;
  reportDigest?: string;
  failures?: string[];
  candidate?: { commit?: string; tree?: string };
  source?: { manifestDigest?: string };
  conclusion?: {
    engineeringAcceptedByAgent?: boolean;
    residualHumanEvidence?: boolean;
    allowedPromotion?: boolean;
  };
  safety?: {
    productLocksChanged?: boolean;
    liveReady?: boolean;
    productApproved?: boolean;
    defaultOn?: boolean;
    promotionAuthorized?: boolean;
  };
};

function loadAcceptedEngineeringEvidence(manifestPath: string, reportPath: string) {
  expect(existsSync(manifestPath)).toBe(true);
  expect(existsSync(reportPath)).toBe(true);

  const manifestBytes = readFileSync(manifestPath);
  const reportBytes = readFileSync(reportPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as EvidenceManifest;
  const report = JSON.parse(reportBytes.toString('utf8')) as EngineeringReport;

  expect(manifest).toMatchObject({
    schema: 'agent-engineering-acceptance/v1',
    manifestVersion: 1,
    executionMode: 'full',
    task: { humanEvidence: 'required' },
    safety: { humanEvidence: 'required' },
    candidate: { cleanAtPlan: true },
  });
  expect(report).toMatchObject({
    schema: 'agent-engineering-acceptance/v1',
    documentType: 'agent-engineering-acceptance-report',
    reportVersion: 1,
    runId: manifest.runId,
    role: 'verifier',
    result: 'pass',
    engineeringAcceptedByAgent: true,
    humanEvidenceRequired: true,
    taskStatusRecommendation: 'review_needed',
    failures: [],
    candidate: {
      commit: manifest.candidate?.commit,
      tree: manifest.candidate?.tree,
    },
    source: { manifestDigest: manifest.manifestDigest },
    conclusion: {
      engineeringAcceptedByAgent: true,
      residualHumanEvidence: true,
      allowedPromotion: false,
    },
    safety: {
      productLocksChanged: false,
      liveReady: false,
      productApproved: false,
      defaultOn: false,
      promotionAuthorized: false,
    },
  });
  expect(report.actor?.trim()).toBeTruthy();
  expect(report.executorActor?.trim()).toBeTruthy();
  expect(report.verifierActor?.trim()).toBeTruthy();
  expect(report.actor).toBe(report.verifierActor);
  expect(report.executorActor).not.toBe(report.verifierActor);
  expect(report.reportDigest).toBe(digestReport(report));

  return { manifestBytes, reportBytes, manifest, report };
}

describe('runtime authority convergence control pack', () => {
  it('keeps the serial engineering and final-human gates explicit', () => {
    const packages = read('WORK-PACKAGES.md');
    const orderedIds = [
      'RC-00',
      'RC-01',
      'RC-02',
      'RC-03',
      'RC-04',
      'RC-05',
      'RC-06A-D',
      'RC-07',
      'RC-08A',
      'RC-08B',
      'RC-09',
      'RC-10',
    ];

    let cursor = -1;
    for (const id of orderedIds) {
      const next = packages.indexOf(`| ${id} |`);
      expect(next, `${id} must exist after the previous package`).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(packages).toContain('Human/live operation is forbidden before `RC-10`.');
    expect(packages).toContain('It must not become `done`.');
  });

  it('allows done only after engineering evidence and explicit user acceptance', () => {
    const statusText = read('STATUS.md');
    const frontmatter = statusText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    expect(frontmatter).not.toBeNull();
    const status = parseYaml(frontmatter?.[1] ?? '') as {
      schema: string;
      program_status: string;
      current_work_package: string | null;
      engineering_verdict: string;
      engineering_report: string | null;
      human_verdict: string;
      human_verdict_record: string | null;
      done_allowed: boolean;
      required_work_packages: string[];
      accepted_work_packages: string[];
      evidence_manifest: string | null;
      product_locks: {
        live_ready: boolean;
        product_approved: boolean;
        default_on: boolean;
      };
    };
    const allowedStatuses = [
      'planned',
      'in_progress',
      'engineering_verification',
      'human_acceptance_pending',
      'done',
    ];

    expect(status.schema).toBe('runtime-authority-convergence-status/v1');
    expect(statusText).not.toContain('# ');
    expect(parseFrontmatter(statusText).body).toBe('');
    expect(allowedStatuses).toContain(status.program_status);
    expect(typeof status.done_allowed).toBe('boolean');
    expect(status.required_work_packages).toEqual([
      'RC-00',
      'RC-01',
      'RC-02',
      'RC-03',
      'RC-04',
      'RC-05',
      'RC-06A',
      'RC-06B',
      'RC-06C',
      'RC-06D',
      'RC-07',
      'RC-08A',
      'RC-08B',
      'RC-09',
      'RC-10',
    ]);
    expect(Array.isArray(status.accepted_work_packages)).toBe(true);
    expect(status.product_locks).toEqual({
      live_ready: false,
      product_approved: false,
      default_on: false,
    });
    if (status.program_status === 'planned') {
      expect(status.current_work_package).toBeNull();
    }
    if (status.program_status !== 'done') {
      expect(status.done_allowed).toBe(false);
    }

    let engineeringEvidence: ReturnType<typeof loadAcceptedEngineeringEvidence> | null = null;
    if (['human_acceptance_pending', 'done'].includes(status.program_status)) {
      expect(status.engineering_verdict).toBe('accepted');
      expect(status.evidence_manifest).toBe(
        'artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/manifest.json',
      );
      expect(status.engineering_report).toBe(
        'artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/final-report.json',
      );
      engineeringEvidence = loadAcceptedEngineeringEvidence(
        status.evidence_manifest ?? '',
        status.engineering_report ?? '',
      );
    }

    if (status.done_allowed === true || status.program_status === 'done') {
      expect(status.engineering_verdict).toBe('accepted');
      expect(status.human_verdict).toBe('accepted');
      expect(status.human_verdict_record).toEqual(expect.any(String));
      expect(status.human_verdict_record?.length ?? 0).toBeGreaterThan(0);
      expect(status.engineering_report).toEqual(expect.any(String));
      expect(status.engineering_report?.length ?? 0).toBeGreaterThan(0);
      expect(status.evidence_manifest).toEqual(expect.any(String));
      expect(status.evidence_manifest?.length ?? 0).toBeGreaterThan(0);
      expect(status.accepted_work_packages).toEqual(status.required_work_packages);
      expect(status.done_allowed).toBe(true);
      expect(status.program_status).toBe('done');

      expect(status.human_verdict_record).toBe(
        'artifacts/agent-engineering-acceptance/runtime-authority-convergence-final/human-verdict.yaml',
      );
      const verdictPath = status.human_verdict_record ?? '';
      expect(existsSync(verdictPath)).toBe(true);

      expect(engineeringEvidence).not.toBeNull();
      const { manifestBytes, reportBytes, manifest } = engineeringEvidence!;
      const verdict = parseYaml(readFileSync(verdictPath, 'utf8')) as {
        candidate_sha?: string;
        manifest_sha256?: string;
        engineering_report_sha256?: string;
        verdict?: string;
        accepted_scenarios?: string[];
        failed_scenarios?: string[];
      };
      expect(verdict.verdict).toBe('accepted');
      expect(verdict.candidate_sha).toBe(manifest.candidate?.commit);
      expect(verdict.manifest_sha256).toBe(
        createHash('sha256').update(manifestBytes).digest('hex'),
      );
      expect(verdict.engineering_report_sha256).toBe(
        createHash('sha256').update(reportBytes).digest('hex'),
      );
      expect(verdict.accepted_scenarios).toEqual([
        'H-01',
        'H-02',
        'H-03',
        'H-04',
        'H-05',
        'H-06',
      ]);
      expect(verdict.failed_scenarios).toEqual([]);
    }
  });

  it('pins anti-wheel boundaries in the durable Harness rule', () => {
    const rule = readFileSync(
      'harness/specs/rules/runtime-authority-convergence-boundary.md',
      'utf8',
    );

    expect(rule).toContain('TaskFlow/TaskRegistry is the workflow convergence candidate');
    expect(rule).toContain('Exactly one configured `memory` slot plugin');
    expect(rule).toContain('single `contextEngine` slot');
    expect(rule).toContain('MCP owns the external capability protocol');
    expect(rule).toContain('OpenTelemetry/OTLP owns telemetry export');
    expect(rule).toContain('runtime-spine paths remain diagnostic-only');
    expect(rule).toContain('RuntimeTaskEventLog is a candidate, not a preselected owner');
    expect(rule).toContain('Approval pending/resolved truth');
    expect(rule).toContain('npm fallback must report explicit capability degradation');
  });

  it('keeps provisional owners and RC numbering consistent across entry points', () => {
    const architecture = read('TARGET-ARCHITECTURE.md');
    const handoff = read('AGENT-START.md');
    const program = readFileSync(
      'harness/specs/tasks/runtime-authority-convergence-program.md',
      'utf8',
    );
    const playbook = readFileSync('docs/dev/Sustained-Development-Playbook.md', 'utf8');

    expect(architecture).toContain('selected and implemented in RC-04');
    expect(architecture).toContain('TaskFlow only after RC-06A proof');
    expect(architecture).not.toContain('selected in RC-08A');
    expect(handoff).toContain('RC-04 必须先闭合 durable approval/effect reconciliation');
    expect(handoff).toContain('未应用则只报告阻塞，不实施任何 RC 工作');
    expect(handoff).not.toContain('RC-08A 必须先闭合 durable approval/effect reconciliation');
    expect(program).toContain('TaskFlow as a conditional workflow candidate until RC-06A proof');
    expect(playbook).toContain('## 3. 历史 P0 主线（2026-07-19 快照）');
    expect(playbook).toContain('提案未应用时不得启动任何 RC');
  });

  it('pins fail-closed final manifest generation and verdict validation', () => {
    const acceptance = read('ACCEPTANCE.md');
    const human = read('HUMAN-ACCEPTANCE.md');
    const packages = read('WORK-PACKAGES.md');

    expect(packages).toContain('invalid or missing `--since` ref must fail');
    expect(packages).toContain('implicit `HEAD^` default');
    expect(packages).toContain('replace the existing no-`--since` success test');
    expect(packages).toContain('missing/blank/non-string actors');
    expect(packages).toContain('missing or incorrect semantic `reportDigest`');
    expect(packages).toContain('produces a real green `verifier-report.json` and `final-report.json`');
    expect(acceptance).toContain('artifacts/runtime-authority-convergence/rc-01/baseline.json');
    expect(acceptance).toContain(
      '$finalDir = "artifacts/agent-engineering-acceptance/runtime-authority-convergence-final"',
    );
    expect(acceptance).toContain("$acceptedBaseSha -notmatch '^[0-9a-fA-F]{40}$'");
    expect(acceptance).toContain('--since $acceptedBaseSha --output-dir $finalDir');
    expect(acceptance).toContain(
      'if ($LASTEXITCODE -ne 0) { throw "acceptance plan failed" }',
    );
    expect(acceptance).toContain(
      'if ($LASTEXITCODE -ne 0) { throw "acceptance verifier failed" }',
    );
    expect(acceptance).toContain('$finalReport.role -ne "verifier"');
    expect(acceptance).toContain(
      '$finalReport.source.manifestDigest -ne $finalManifest.manifestDigest',
    );
    expect(acceptance).toContain('$finalManifest.baseRef -cne $acceptedBaseSha');
    expect(acceptance).toContain('final manifest changedPaths mismatch');
    expect(acceptance).toContain('humanEvidence: required');
    expect(acceptance).toContain('$finalReport.humanEvidenceRequired -ne $true');
    expect(acceptance).toContain('$finalReport.safety.productLocksChanged -ne $false');
    expect(acceptance).toContain('$finalReport.conclusion.allowedPromotion -ne $false');
    expect(acceptance).toContain('final evidence directory already exists');
    expect(acceptance.indexOf('$finalManifest = Get-Content')).toBeLessThan(
      acceptance.indexOf('pnpm acceptance:agent:run'),
    );
    expect(acceptance).toContain(
      'node scripts/validate-runtime-authority-convergence.mjs --phase engineering',
    );
    expect(acceptance).toContain(
      'invalid or missing base exits nonzero instead of falling back to `HEAD` or `HEAD^`',
    );
    expect(human).toContain('recompute both file SHA-256 values');
    expect(human).toContain('engineering_report_sha256');
    expect(human).toContain('green result, `engineeringAcceptedByAgent=true`');
    expect(human).toContain('node scripts/validate-runtime-authority-convergence.mjs --phase human');
    expect(human).toContain('The validator may verify the user\'s record; it may not create or edit');
  });

  it('keeps the legacy runtime-family task as a non-authorizing tombstone', () => {
    const legacy = readFileSync(
      'harness/specs/tasks/runtime-family-unification-v1.md',
      'utf8',
    );
    const spec = parseFrontmatter(legacy).data;

    expect(spec.ownedPaths).toEqual([
      'harness/specs/tasks/runtime-family-unification-v1.md',
    ]);
    expect(spec.requiredRules).toContain('runtime-authority-convergence-boundary');
    expect(legacy).toContain('Status: non-authorizing.');
    expect(legacy).not.toContain('## WP1');
  });

  it('maps every convergence package to the proposed Task Forest without old numbering', () => {
    const proposal = JSON.parse(
      readFileSync(
        '.agent-workbench/task-forest/proposals/TFP-runtime-authority-convergence-20260802.json',
        'utf8',
      ),
    ) as {
      status: string;
      changes: Array<{
        action: string;
        alias?: string;
        id?: string;
        from?: string;
        to?: string;
        type?: string;
        fields?: { next_action?: string; acceptance_criteria?: string[] };
        node?: { title?: string };
      }>;
    };
    const nodes = new Map(
      proposal.changes
        .filter((change) => change.action === 'add_node' && change.alias)
        .map((change) => [change.alias, change.node?.title]),
    );

    const statusFrontmatter = read('STATUS.md').match(
      /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
    );
    const programStatus = parseYaml(statusFrontmatter?.[1] ?? '') as {
      program_status?: string;
    };
    if (programStatus.program_status === 'planned') {
      expect(proposal.status).toBe('proposed');
    } else {
      expect(proposal.status).toBe('applied');
    }
    expect([...nodes.keys()].sort()).toEqual([
      'rc-01',
      'rc-02',
      'rc-03',
      'rc-04',
      'rc-05',
      'rc-06a',
      'rc-06b',
      'rc-06c',
      'rc-06d',
      'rc-07',
      'rc-08a',
      'rc-08b',
      'rc-09',
      'rc-10',
      'rc-program',
    ]);
    expect(Object.fromEntries(nodes)).toEqual(
      expect.objectContaining({
        'rc-01': 'RC-01 权威重基线与停止扩张清单',
        'rc-02': 'RC-02 Full-payload Shadow Census',
        'rc-03': 'RC-03 DCS Seal 与双收据',
        'rc-04': 'RC-04 Durable Approval 与 Effect Reconciliation',
        'rc-05': 'RC-05 最小 Operator 治理切片',
        'rc-06a': 'RC-06A TaskFlow 能力与并发语义证明',
        'rc-06b': 'RC-06B ClawGraph Lifecycle 迁移',
        'rc-06c': 'RC-06C Mission Lifecycle 迁移',
        'rc-06d': 'RC-06D Task Loop Lifecycle 迁移',
        'rc-07': 'RC-07 Memory 与 Context 插件槽收敛',
        'rc-08a': 'RC-08A MCP 与 Host-native Tool 收敛',
        'rc-08b': 'RC-08B OTel 与 Observability 收敛',
        'rc-09': 'RC-09 独立工程总验收与证据封存',
        'rc-10': 'RC-10 最终真人 Provider/Channel/Recovery 验收',
      }),
    );
    expect([...nodes.values()]).not.toContain('RC-04 TaskFlow 统一 Workflow Authority');
    expect([...nodes.values()]).not.toContain('RC-08 跨入口 Operator 治理垂直切片');

    const acceptanceReuse = proposal.changes.find(
      (change) => change.action === 'update_node' && change.id === 'TF-0020',
    );
    expect(acceptanceReuse?.fields?.next_action).toContain('直接承担 RC-00');
    expect(acceptanceReuse?.fields?.acceptance_criteria).toContain(
      '缺失或异常 actor、相同 Executor/Verifier 身份、错误或缺失 semantic reportDigest 均 NO-GO',
    );
    expect(acceptanceReuse?.fields?.acceptance_criteria).toContain(
      '真实隔离 fixture 生成绿色 verifier-report.json 与 final-report.json',
    );

    const edges = new Set(
      proposal.changes
        .filter((change) => change.action === 'add_edge')
        .map((change) => `${change.from}->${change.to}:${change.type}`),
    );
    for (const edge of [
      'rc-01->TF-0020:depends_on',
      'rc-02->rc-01:depends_on',
      'rc-03->rc-02:depends_on',
      'rc-04->rc-03:depends_on',
      'rc-05->rc-04:depends_on',
      'rc-06b->rc-06a:depends_on',
      'rc-06c->rc-06b:depends_on',
      'rc-06d->rc-06c:depends_on',
      'rc-07->rc-06d:depends_on',
      'rc-08a->rc-07:depends_on',
      'rc-08b->rc-08a:depends_on',
      'rc-09->rc-08b:depends_on',
      'rc-10->rc-09:depends_on',
    ]) {
      expect(edges).toContain(edge);
    }
  });

  it('rejects incomplete or fixture-only human acceptance', () => {
    const human = read('HUMAN-ACCEPTANCE.md');

    expect(human).toContain('If a real channel is unavailable, RC-10 is `blocked`');
    expect(human).toContain(
      '`accepted_scenarios` is exactly `[H-01, H-02, H-03, H-04, H-05, H-06]`',
    );
    expect(human).toContain('`failed_scenarios` is empty');
    expect(human).toContain('`manifest_sha256` matches the final manifest');
    expect(human).toContain(
      '`engineering_report_sha256` matches the independent Verifier `final-report.json`',
    );
  });
});
