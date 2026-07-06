import {
  type Selector,
  normalizeResourceId,
  normalizeSelector,
} from '../../../../shared/types/context-runtime-kit';
import type { CvkFixtureArtifact } from './compiler';

export type CvkToolSelectorFamily =
  | 'required'
  | 'enum'
  | 'type'
  | 'default'
  | 'nullable'
  | 'permission'
  | 'side_effect';

export type CvkToolCallGateMode = 'report_only';

export type CvkRequiredToolSelector = {
  family: CvkToolSelectorFamily;
  selector: Selector;
};

export type CvkToolCallGateDiagnostic = {
  code: 'missing_tool_selector';
  severity: 'would_block';
  family: CvkToolSelectorFamily;
  selector: Selector;
  message: string;
};

export type CvkToolCallGateResult = {
  ok: boolean;
  mode: CvkToolCallGateMode;
  wouldBlock: boolean;
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
  const requiredSelectors = collectRequiredToolSelectors(input.artifact, input.resourceId, input.toolName);
  const retrieved = new Set(input.retrievedSelectors.map((selector) => normalizeSelector(selector)));
  const missingSelectors = requiredSelectors.filter((required) => !retrieved.has(required.selector));
  const diagnostics = missingSelectors.map((missing): CvkToolCallGateDiagnostic => ({
    code: 'missing_tool_selector',
    severity: 'would_block',
    family: missing.family,
    selector: missing.selector,
    message: `Report-only tool gate would block ${input.toolName} until ${missing.selector} is retrieved.`,
  }));

  return {
    ok: missingSelectors.length === 0,
    mode: input.mode,
    wouldBlock: missingSelectors.length > 0,
    requiredSelectors,
    missingSelectors,
    diagnostics,
  };
}
