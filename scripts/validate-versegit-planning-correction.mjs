#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedSchemas = {
  core: 'clawx.versegit.planning-correction/v2',
  m1: 'clawx.versegit.m1-effect-matrix/v2',
  receipt: 'clawx.verseshell.execution-receipt/v2',
  provider: 'clawx.versegit.provider-contracts/v2',
  inputFreeze: 'clawx.versegit.input-freeze/v2',
  nodes: 'clawx.versegit.node-acceptance-matrix/v2',
  soak: 'clawx.versegit.resource-soak/v2',
  evidence: 'clawx.versegit.evidence-retention/v2',
};
const expectedNodeIds = [
  'TF-0465','TF-0466','TF-0467','TF-0468','TF-0469','TF-0470','TF-0471','TF-0472',
  'TF-0473','TF-0474','TF-0475','TF-0476','TF-0477','TF-0478','TF-0479','TF-0480',
];
const requiredEdges = [
  ['TF-0466','TF-0476'], ['TF-0478','TF-0466'], ['TF-0477','TF-0478'],
  ['TF-0467','TF-0477'], ['TF-0468','TF-0477'], ['TF-0469','TF-0477'],
];

function readJson(path) {
  if (!existsSync(path)) throw new Error(`missing file: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function requireKeys(object, keys, label, issues) {
  for (const key of keys) {
    if (object?.[key] === undefined) issues.push(`${label}: missing ${key}`);
  }
}

function validateCore(core, issues) {
  requireKeys(core, ['review_input','p0','p1','dag','non_goals','completion','authority','status_model'], 'core', issues);
  if (core.review_input?.verdict !== 'FAIL') issues.push('core: review input must preserve FAIL');
  if (!core.review_input?.required_re_review_verdict?.includes('PASS_WITH_GAPS')) issues.push('core: PASS_WITH_GAPS re-review required');
  if (core.completion?.clean_tree_full_validation_required !== true) issues.push('core: clean-tree full validation required');
  if (core.authority?.execution_graph !== '.agent-workbench/task-forest/graph/forest.json') issues.push('core: live graph must be execution authority');
  const required = new Set((core.dag?.required_edges ?? []).map((edge) => `${edge.from}->${edge.to}`));
  for (const [from,to] of requiredEdges) if (!required.has(`${from}->${to}`)) issues.push(`dag: missing ${from}->${to}`);
  if (!(core.dag?.optional_nodes ?? []).includes('TF-0479')) issues.push('dag: TF-0479 must be optional');
  if (!(core.dag?.deprecated_nodes ?? []).some((n) => n.id === 'TF-0480')) issues.push('dag: TF-0480 must be deprecated');
}

function validateDagAgainstGraph(core, root, issues) {
  const graphPath = resolve(root, '.agent-workbench/task-forest/graph/forest.json');
  if (!existsSync(graphPath)) {
    issues.push('dag: live Task Forest graph missing');
    return;
  }
  const graph = readJson(graphPath);
  const edges = Object.values(graph.edges ?? {}).filter((edge) => edge.type === 'depends_on');
  for (const [from,to] of requiredEdges) {
    if (!edges.some((edge) => edge.from === from && edge.to === to)) issues.push(`dag: live graph missing ${from}->${to}`);
  }
  if (edges.some((edge) => edge.from === 'TF-0478' && edge.to === 'TF-0477')) issues.push('dag: live graph contains forbidden TF-0478->TF-0477');
  if (graph.nodes?.['TF-0480']?.status !== 'deprecated') issues.push('dag: TF-0480 must be deprecated in live graph');
  const optionalStatus = graph.nodes?.['TF-0479']?.status;
  if (!['proposed', 'done'].includes(optionalStatus)) issues.push('dag: TF-0479 must be optional/proposed or explicitly completed');
  if (optionalStatus === 'done' && !existsSync(resolve(root, 'harness/specs/fixtures/versegit-planning-correction/mc6-evidence/decision.json'))) issues.push('dag: completed TF-0479 requires MC6 decision evidence');
  const correctionStatus = graph.nodes?.['TF-0481']?.status;
  if (correctionStatus !== 'in_progress' && correctionStatus !== 'done') {
    issues.push('dag: TF-0481 must be in_progress while open or done after correction');
  }
  const ready = graph.status_queues?.ready ?? [];
  const implementationIds = [
    'TF-0466','TF-0467','TF-0468','TF-0469','TF-0470','TF-0471','TF-0472',
    'TF-0473','TF-0474','TF-0475','TF-0476','TF-0477','TF-0478','TF-0479',
  ];
  const implementationReady = ready.filter((id) => implementationIds.includes(id));
  if (correctionStatus !== 'done' && implementationReady.length > 0) {
    issues.push(`dag: VG implementation ready before TF-0481 closes: ${implementationReady.join(',')}`);
    return;
  }
  if (correctionStatus === 'done') {
    const doneDeps = (id) => edges.filter((edge) => edge.from === id).map((edge) => edge.to).every((dep) => graph.nodes?.[dep]?.status === 'done');
    const sequence = ['TF-0473','TF-0474','TF-0475','TF-0476','TF-0466','TF-0478','TF-0477','TF-0467','TF-0468','TF-0469','TF-0470','TF-0471','TF-0472'];
    for (const id of implementationReady) {
      if (!doneDeps(id)) issues.push(`dag: VG node ${id} is ready before its dependencies are done`);
    }
    const firstOpen = sequence.find((id) => graph.nodes?.[id]?.status !== 'done');
    const unexpected = implementationReady.filter((id) => id !== firstOpen);
    if (unexpected.length > 0) issues.push(`dag: VG ready queue bypasses ordered next node ${firstOpen ?? 'none'}: ${unexpected.join(',')}`);
  }
}

function validateM1(m1, issues) {
  if (!Array.isArray(m1.existing_cli) || !Array.isArray(m1.target_seams)) issues.push('m1: existing_cli and target_seams required');
  const cli = new Map((m1.existing_cli ?? []).map((entry) => [entry.entry, entry]));
  for (const name of ['capabilities','doctor','conflicts','session_show','verdict_facts']) if (!cli.has(name)) issues.push(`m1: missing existing CLI ${name}`);
  for (const name of ['doctor','conflicts','session_show']) if (cli.get(name)?.pure_diagnostic !== false) issues.push(`m1: existing ${name} must be non-pure`);
  for (const seam of ['provider.status','provider.doctor','provider.conflicts-plan','provider.session-status']) {
    if (!(m1.target_seams ?? []).some((entry) => entry.entry === seam && entry.pure_diagnostic === true)) issues.push(`m1: missing pure target seam ${seam}`);
  }
  for (const forbidden of ['initialize','migrate','materialize','execute_check','write_workspace','write_domain_state','observe_event']) {
    if (!(m1.forbidden_in_m1 ?? []).includes(forbidden)) issues.push(`m1: missing forbidden ${forbidden}`);
  }
}

function validateReceipt(receipt, issues) {
  for (const binding of ['planId','planDigest','candidateId','checkId','ownerId','epoch','authorizationId','argvDigest','cwdDigest','envDigest','executionInputDigest','requiredScope','artifactDigests','cleanupStatus']) {
    if (!(receipt.required_bindings ?? []).includes(binding)) issues.push(`receipt: missing ${binding}`);
  }
  for (const rejection of ['wrong_candidate','stale_epoch','plan_digest_mismatch','script_drift','duplicate_receipt','missing_or_forged_artifact','selected_scope_claimed_as_full']) {
    if (!(receipt.rejects ?? []).includes(rejection)) issues.push(`receipt: missing rejection ${rejection}`);
  }
  if (receipt.authority?.caller_self_report_allowed !== false) issues.push('receipt: caller self-report must be forbidden');
  for (const binding of ['observationId','observationDigest','planFileDigest','inputManifestDigest']) {
    if (!(receipt.live_evidence?.required_bindings ?? []).includes(binding)) issues.push(`receipt: missing live evidence ${binding}`);
  }
  if (receipt.live_evidence?.missing_authority_result !== 'rejected_by_policy') issues.push('receipt: missing live authority must be rejected_by_policy');
  if (receipt.live_evidence?.unverified_live_claim_result !== 'partial') issues.push('receipt: unverified live claim must remain partial');
}

function validateProvider(provider, issues) {
  if (!provider.production_responsibility?.provider_nodes?.includes('TF-0476')) issues.push('provider: TF-0476 must own delivery');
  if (provider.cleanup_barrier?.implementation_owner_node !== 'TF-0467') issues.push('provider: TF-0467 must own cleanup barrier integration');
  for (const id of ['programmatic worktree cleanup','user-requested worktree cleanup','stale worktree pruning','failure-path cleanup']) {
    if (!(provider.cleanup_barrier?.covered_entries ?? []).includes(id)) issues.push(`provider: missing cleanup entry ${id}`);
  }
  const expectedOrder = ['stop_accepting_work','drain_or_cancel_inflight','seal_evidence','detach_vg_session','verify_owner_epoch_reference','delete_disposable_worktree'];
  if (JSON.stringify(provider.cleanup_barrier?.order) !== JSON.stringify(expectedOrder)) issues.push('provider: cleanup order mismatch');
  for (const id of ['effective_source_commit','source_tree_digest','build_recipe_digest','lockfile_digest','platform','binary_sha256','capabilities_digest','contract_digest','golden_bundle_digest','capability_matrix_digest']) {
    if (!(provider.delivery?.required_identity ?? []).includes(id)) issues.push(`provider: delivery missing ${id}`);
  }
  if (!provider.state?.layout?.epoch_storage) issues.push('provider: durable epoch required');
  if (!provider.state?.upgrade_interruption) issues.push('provider: upgrade interruption required');
}

function validateInputFreeze(freeze, issues) {
  if (freeze.inprocess_backend?.supported !== false) issues.push('input freeze: inprocess unsupported');
  if (freeze.normalization?.hash !== 'sha256' || freeze.normalization?.path_order !== 'ordinal_ascending') issues.push('input freeze: canonical hash/order required');
  for (const id of ['matched','dirty_drift','untracked_added','inprocess_backend']) {
    if (!(freeze.examples ?? []).some((example) => example.case === id)) issues.push(`input freeze: missing example ${id}`);
  }
}

function validateNodes(nodes, root, issues) {
  const ids = (nodes.nodes ?? []).map((node) => node.id);
  if (new Set(ids).size !== ids.length) issues.push('nodes: duplicate id');
  for (const id of expectedNodeIds) if (!ids.includes(id)) issues.push(`nodes: missing ${id}`);
  const fixtureRoot = resolve(root, 'harness/specs/fixtures/versegit-planning-correction');
  for (const node of nodes.nodes ?? []) {
    requireKeys(node, ['id','role','anchor','fixture','artifact','planningVerifier','executionVerifier','closure','next'], `node:${node.id}`, issues);
    if (!node.anchor.startsWith('#')) issues.push(`node:${node.id}: anchor must start with #`);
    if (node.id !== 'TF-0480') {
      if (!existsSync(resolve(fixtureRoot, node.fixture))) issues.push(`node:${node.id}: fixture not found ${node.fixture}`);
      if (node.executionVerifier === node.planningVerifier || node.executionVerifier.includes('validate-versegit-planning-correction.mjs')) {
        issues.push(`node:${node.id}: planning verifier cannot serve as execution verifier`);
      }    }
  }
  if (nodes.nodes?.find((node) => node.id === 'TF-0480')?.executionVerifier !== 'none: deprecated and merged into TF-0472') issues.push('nodes: TF-0480 execution verifier disposition');
}

function validateSoak(soak, issues) {
  if ((soak.soak_recipe?.cases ?? []).length < 8) issues.push('soak: bounded cases required');
  if (!soak.soak_recipe?.oracles || !soak.performance_tolerances?.measurement) issues.push('soak: oracles and measurement required');
  if (soak.soak_recipe?.worktrees !== 3) issues.push('soak: three worktrees required');
}

function validateEvidence(evidence, issues) {
  if (evidence.sealing?.atomic !== true) issues.push('evidence: atomic seal required');
  if (!evidence.sealing?.pre_cleanup_manifest || !evidence.sealing?.post_cleanup_attachment) issues.push('evidence: pre/post cleanup attachment required');
}

export function validateVerseGitPlanningCorrection({ root = repositoryRoot, node } = {}) {
  const issues = [];
  const fixtureDir = resolve(root, 'harness/specs/fixtures/versegit-planning-correction');
  let core;
  try { core = readJson(resolve(fixtureDir, 'planning-contract.json')); } catch (error) { return { ok:false, issues:[error.message] }; }
  if (core.schema !== expectedSchemas.core) issues.push(`core: schema mismatch ${core.schema}`);
  validateCore(core, issues);
  validateDagAgainstGraph(core, root, issues);
  const files = {
    m1: 'm1-effect-matrix.json', receipt: 'execution-receipt-contract.json', provider: 'provider-contracts.json',
    inputFreeze: 'input-freeze-contract.json', nodes: 'node-acceptance-matrix.json', soak: 'resource-soak-plan.json',
    evidence: 'evidence-retention-contract.json',
  };
  const data = {};
  for (const [key,file] of Object.entries(files)) {
    try {
      data[key] = readJson(resolve(fixtureDir,file));
      if (data[key].schema !== expectedSchemas[key]) issues.push(`${key}: schema mismatch ${data[key].schema}`);
    } catch (error) { issues.push(error.message); }
  }
  if (data.m1) validateM1(data.m1, issues);
  if (data.receipt) validateReceipt(data.receipt, issues);
  if (data.provider) validateProvider(data.provider, issues);
  if (data.inputFreeze) validateInputFreeze(data.inputFreeze, issues);
  if (data.nodes) validateNodes(data.nodes, root, issues);
  if (data.soak) validateSoak(data.soak, issues);
  if (data.evidence) validateEvidence(data.evidence, issues);
  if (node && !(data.nodes?.nodes ?? []).some((entry) => entry.id === node)) issues.push(`node: not found ${node}`);
  return { ok: issues.length === 0, issues, node: node ?? null };
}

async function main() {
  const nodeIndex = process.argv.indexOf('--node');
  const node = nodeIndex >= 0 ? process.argv[nodeIndex + 1] : undefined;
  const result = validateVerseGitPlanningCorrection({ node });
  if (!result.ok) {
    for (const issue of result.issues) console.error(`[versegit-planning] FAIL: ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[versegit-planning] OK${node ? ` node=${node}` : ''}`);
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(`[versegit-planning] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
