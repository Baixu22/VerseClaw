import {
  loadGuideSpecs,
  loadLayerSpecs,
  loadRuleSpecs,
  loadScenarioSpecs,
  loadSpec,
  pathMatchesAny,
  toArray,
} from './specs.mjs';

function uniqueById(specs) {
  const seen = new Set();
  const result = [];
  for (const spec of specs) {
    const key = spec.data?.id ?? spec.path;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(spec);
  }
  return result;
}

function taskScenarioIds(taskSpec) {
  return [
    ...toArray(taskSpec.data?.scenario),
    ...toArray(taskSpec.data?.scenarios),
  ].filter(Boolean);
}

function intersects(left, right) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function matchesTaskPaths(contextSpec, taskSpec) {
  const patterns = [
    ...toArray(contextSpec.data?.pathPatterns),
    ...toArray(contextSpec.data?.ownedPaths),
  ];
  if (patterns.length === 0) return false;

  const taskPaths = [
    ...toArray(taskSpec.data?.touchedAreas),
    ...toArray(taskSpec.data?.ownedPaths),
  ];
  return taskPaths.some((filePath) => pathMatchesAny(filePath, patterns));
}

function appliesToTask(contextSpec, taskSpec, scenarioIds) {
  const selectors = [
    taskSpec.data?.id,
    taskSpec.data?.taskType,
    taskSpec.data?.type,
    ...scenarioIds,
  ].filter(Boolean);

  const appliesTo = toArray(contextSpec.data?.appliesTo);
  if (appliesTo.includes('all')) return true;
  if (intersects(appliesTo, selectors)) return true;

  const specScenarios = [
    ...toArray(contextSpec.data?.scenario),
    ...toArray(contextSpec.data?.scenarios),
  ];
  if (intersects(specScenarios, scenarioIds)) return true;

  return matchesTaskPaths(contextSpec, taskSpec);
}

function requiredRuleIds(taskSpec, scenarios) {
  return [
    ...toArray(taskSpec.data?.requiredRules),
    ...scenarios.flatMap((scenario) => toArray(scenario.data?.requiredRules)),
  ].filter(Boolean);
}

export async function buildContext(specPath) {
  const task = await loadSpec(specPath);
  const scenarioIds = taskScenarioIds(task);
  const allScenarios = await loadScenarioSpecs();
  const scenarios = allScenarios.filter((scenario) => scenarioIds.includes(scenario.data?.id));
  const missingScenarios = scenarioIds.filter((id) => !scenarios.some((scenario) => scenario.data?.id === id));

  const ruleIds = requiredRuleIds(task, scenarios);
  const allRules = await loadRuleSpecs();
  const rules = allRules.filter((rule) => ruleIds.includes(rule.data?.id));
  const missingRules = ruleIds.filter((id) => !rules.some((rule) => rule.data?.id === id));

  const guides = uniqueById(
    (await loadGuideSpecs()).filter((guide) => appliesToTask(guide, task, scenarioIds)),
  );
  const layers = uniqueById(
    (await loadLayerSpecs()).filter((layer) => appliesToTask(layer, task, scenarioIds)),
  );

  const readOrder = [
    task,
    ...scenarios,
    ...rules,
    ...guides,
    ...layers,
  ];

  return {
    task,
    scenarios: uniqueById(scenarios),
    rules: uniqueById(rules),
    guides,
    layers,
    missingScenarios: [...new Set(missingScenarios)].sort(),
    missingRules: [...new Set(missingRules)].sort(),
    readOrder: uniqueById(readOrder),
  };
}

export function formatContext(context) {
  const lines = [];
  lines.push(`Context for: ${context.task.path}`);
  lines.push(`Intent: ${context.task.data?.intent ?? 'n/a'}`);
  lines.push('');
  lines.push('Read order:');
  for (const spec of context.readOrder) {
    lines.push(`- ${spec.data?.id ?? 'unknown'} (${spec.data?.type ?? 'task'}): ${spec.path}`);
  }

  if (context.missingScenarios.length > 0 || context.missingRules.length > 0) {
    lines.push('');
    lines.push('Missing references:');
    for (const id of context.missingScenarios) lines.push(`- scenario: ${id}`);
    for (const id of context.missingRules) lines.push(`- rule: ${id}`);
  }

  return lines.join('\n');
}
