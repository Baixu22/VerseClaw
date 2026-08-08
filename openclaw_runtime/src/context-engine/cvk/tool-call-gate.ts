import {
  type Selector,
  normalizeResourceId,
  normalizeSelector,
} from '../../../../shared/types/context-runtime-kit.js';
import type { CvkFixtureArtifact } from './compiler.js';

export type CvkToolSelectorFamily =
  | 'required'
  | 'enum'
  | 'type'
  | 'default'
  | 'nullable'
  | 'permission'
  | 'side_effect';

/** report_only: diagnostics only; enforce: missing selectors deny the tool call. */
export type CvkToolCallGateMode = 'report_only' | 'enforce';

export type CvkRequiredToolSelector = {
  family: CvkToolSelectorFamily;
  selector: Selector;
};

export type CvkToolCallGateDiagnostic = {
  code: 'missing_tool_selector';
  severity: 'would_block' | 'block';
  family: CvkToolSelectorFamily;
  selector: Selector;
  message: string;
};

export type CvkToolCallGateResult = {
  ok: boolean;
  mode: CvkToolCallGateMode;
  wouldBlock: boolean;
  /** True when enforce mode would deny the tool call. */
  denied: boolean;
  requiredSelectors: CvkRequiredToolSelector[];
  missingSelectors: CvkRequiredToolSelector[];
  diagnostics: CvkToolCallGateDiagnostic[];
};

export type CvkToolCallGateInput = {
  artifact: CvkFixtureArtifact;
  mode: CvkToolCallGateMode;
  resourceId: string;
  toolName: string;
  retrievedSelectors: string[];
};

const FAMILY_ORDER: CvkToolSelectorFamily[] = [
  'required',
  'enum',
  'type',
  'default',
  'nullable',
  'permission',
  'side_effect',
];

const VALID_MODES = new Set<CvkToolCallGateMode>(['report_only', 'enforce']);

/**
 * Resolve CVK tool-call gate mode from explicit value, env, or default.
 * Env: OPENCLAW_CVK_TOOL_GATE_MODE=report_only|enforce
 */
export function resolveCvkToolCallGateMode(
  explicit?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): CvkToolCallGateMode {
  const candidates = [explicit, env.OPENCLAW_CVK_TOOL_GATE_MODE];
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim().toLowerCase();
    if (VALID_MODES.has(normalized as CvkToolCallGateMode)) {
      return normalized as CvkToolCallGateMode;
    }
  }
  return 'report_only';
}

function selectorFamily(selector: string, toolName: string): CvkToolSelectorFamily | undefined {
  if (selector === `schema:tool.${toolName}.required`) return 'required';
  if (selector === `schema:tool.${toolName}.permission`) return 'permission';
  if (selector === `schema:tool.${toolName}.side_effect`) return 'side_effect';
  if (selector.startsWith(`schema:tool.${toolName}.field.`) && selector.endsWith('.enum')) return 'enum';
  if (selector.startsWith(`schema:tool.${toolName}.field.`) && selector.endsWith('.type')) return 'type';
  if (selector.startsWith(`schema:tool.${toolName}.field.`) && selector.endsWith('.default')) return 'default';
  if (selector.startsWith(`schema:tool.${toolName}.field.`) && selector.endsWith('.nullable')) return 'nullable';
  return undefined;
}

function familyRank(family: CvkToolSelectorFamily): number {
  return FAMILY_ORDER.indexOf(family);
}

export function collectRequiredToolSelectors(
  artifact: CvkFixtureArtifact,
  resourceIdInput: string,
  toolName: string,
): CvkRequiredToolSelector[] {
  const resourceId = normalizeResourceId(resourceIdInput);
  return artifact.chunks
    .filter((chunk) => chunk.resourceId === resourceId)
    .flatMap((chunk) => {
      const family = selectorFamily(chunk.selector, toolName);
      return family ? [{ family, selector: chunk.selector }] : [];
    })
    .sort((left, right) => {
      const rank = familyRank(left.family) - familyRank(right.family);
      return rank !== 0 ? rank : left.selector.localeCompare(right.selector);
    });
}

export function verifyCvkToolCallSelectors(input: CvkToolCallGateInput): CvkToolCallGateResult {
  const mode = resolveCvkToolCallGateMode(input.mode);
  const requiredSelectors = collectRequiredToolSelectors(input.artifact, input.resourceId, input.toolName);
  const retrieved = new Set(input.retrievedSelectors.map((selector) => normalizeSelector(selector)));
  const missingSelectors = requiredSelectors.filter((required) => !retrieved.has(required.selector));
  const enforce = mode === 'enforce';
  const diagnostics = missingSelectors.map((missing): CvkToolCallGateDiagnostic => ({
    code: 'missing_tool_selector',
    severity: enforce ? 'block' : 'would_block',
    family: missing.family,
    selector: missing.selector,
    message: enforce
      ? `Enforce tool gate blocks ${input.toolName} until ${missing.selector} is retrieved.`
      : `Report-only tool gate would block ${input.toolName} until ${missing.selector} is retrieved.`,
  }));

  const missing = missingSelectors.length > 0;
  return {
    ok: !missing,
    mode,
    wouldBlock: missing,
    denied: enforce && missing,
    requiredSelectors,
    missingSelectors,
    diagnostics,
  };
}
