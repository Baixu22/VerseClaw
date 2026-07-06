import {
  getAgentDevScenario,
  isAgentDevScenarioId,
  listAgentDevScenarios,
  type AgentDevScenarioDefinition,
  type AgentDevScenarioId,
} from './scenarios';

export type AgentDevScenarioComposition = {
  expression: string | null;
  ids: AgentDevScenarioId[];
  invalidIds: string[];
  scenarios: AgentDevScenarioDefinition[];
  route: string | null;
  seed: Record<string, unknown>;
  overrides: Record<string, string | string[]>;
};

type QueryLike = URLSearchParams | Record<string, string | string[] | undefined | null>;

function queryEntries(query?: QueryLike): Array<[string, string]> {
  if (!query) return [];
  if (query instanceof URLSearchParams) {
    return Array.from(query.entries());
  }
  return Object.entries(query).flatMap(([key, value]) => {
    if (Array.isArray(value)) return value.map((entry) => [key, entry] as [string, string]);
    return typeof value === 'string' ? [[key, value] as [string, string]] : [];
  });
}

export function parseAgentDevScenarioExpression(expression: string | null | undefined): {
  ids: AgentDevScenarioId[];
  invalidIds: string[];
} {
  const seen = new Set<AgentDevScenarioId>();
  const ids: AgentDevScenarioId[] = [];
  const invalidIds: string[] = [];
  for (const part of (expression ?? '').split('+')) {
    const id = part.trim();
    if (!id) continue;
    if (!isAgentDevScenarioId(id)) {
      invalidIds.push(id);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ids, invalidIds };
}

export function extractAgentDevScenarioOverrides(query?: QueryLike): Record<string, string | string[]> {
  const overrides: Record<string, string | string[]> = {};
  for (const [key, value] of queryEntries(query)) {
    if (key === 'devScenario') continue;
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      const existing = overrides[key];
      overrides[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      overrides[key] = value;
    }
  }
  return overrides;
}

export function composeAgentDevScenario(
  expression: string | null | undefined,
  query?: QueryLike,
): AgentDevScenarioComposition {
  const { ids, invalidIds } = parseAgentDevScenarioExpression(expression);
  const scenarios = ids.map(getAgentDevScenario);
  const overrides = extractAgentDevScenarioOverrides(query);
  const seed = Object.assign({}, ...scenarios.map((scenario) => scenario.seed), overrides);
  const route = scenarios.at(-1)?.route ?? null;
  return {
    expression: ids.length > 0 ? ids.join('+') : null,
    ids,
    invalidIds,
    scenarios,
    route,
    seed,
    overrides,
  };
}

export function composeAgentDevScenarioFromSearchParams(params: URLSearchParams): AgentDevScenarioComposition {
  return composeAgentDevScenario(params.get('devScenario'), params);
}

export { listAgentDevScenarios };
