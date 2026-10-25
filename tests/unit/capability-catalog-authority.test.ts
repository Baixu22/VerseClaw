// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
  canonicalizeMetadataValue,
  hashCapabilityMetadata,
  type CapabilityDescriptor,
} from '../../openclaw_runtime/src/capabilities/v3/capability-descriptor.js';
import {
  CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS,
  evaluateCapabilityRegistryV3Baseline,
} from '../../openclaw_runtime/src/capabilities/v3/evaluation-baseline.js';
import {
  CAPABILITY_SHADOW_CATALOG_SCHEMA_VERSION,
  buildCapabilityShadowCatalog,
} from '../../openclaw_runtime/src/capabilities/v3/shadow-catalog.js';
import { CAPABILITY_UNIFIED_RESOLVER_SCHEMA_VERSION } from '../../openclaw_runtime/src/capabilities/v3/unified-resolver.js';
import { TOOL_SEARCH_RAW_TOOL_NAME } from '../../openclaw_runtime/src/agents/tool-search.js';
import {
  COMPONENT_AUTHORITY_MANIFEST,
} from '../../shared/component-authority-manifest.js';
import { COMPONENT_DISPOSITION_MANIFEST } from '../../shared/dcs/component-disposition-catalog.js';
import { COMPONENT_GRADUATION_PROFILE_SCHEMA } from '../../shared/component-graduation-report.js';

const root = process.cwd();
const acceptanceDir = 'tests/unit/fixtures/capability-registry-v3/acceptance/TF-0501';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

describe('TF-0501 single capability catalog authority', () => {
  it('names one V3 catalog identity and keeps V3 internal', () => {
    const component = COMPONENT_AUTHORITY_MANIFEST.components.find(
      (item) => item.id === 'v3-capability-catalog',
    );
    const disposition = COMPONENT_DISPOSITION_MANIFEST.entries.find(
      (item) => item.coverage.authorityComponentIds?.includes('v3-capability-catalog'),
    );
    expect(component).toBeDefined();
    expect(component?.defaultMode).toBe('internal');
    // TF-0501 decides the identity/authority and removes the user-visible
    // V3 surface. TF-0502 may implement the single capability catalog, but it
    // must not reintroduce a second V3 UI/route/flag.
    expect(disposition?.disposition).toBe('internal');
    expect(disposition?.targetDefaultMode).toBe('internal');
    expect(disposition?.visibility).toBe('internal');
    expect(disposition?.userEntry).toBeNull();
    expect(disposition?.coverage.settingsSectionIds).toBeUndefined();
    expect(disposition?.coverage.routePaths).toBeUndefined();
    expect(component?.forbiddenActions).toContain('own-executor-closure');
    expect(component?.forbiddenActions).toContain('execute-tool-effect');
    expect(component?.forbiddenActions).toContain('own-context-candidates');
  });

  it('keeps Tool Search as the execution owner and V3 as metadata only', () => {
    const toolSearch = COMPONENT_AUTHORITY_MANIFEST.components.find(
      (item) => item.id === 'tool-search-schema-expander',
    );
    expect(toolSearch?.purpose).toContain('schema expansion');
    expect(toolSearch?.forbiddenActions).toContain('own-executor-closure');
    expect(toolSearch?.forbiddenActions).toContain('accept-capability-descriptor');
    expect(TOOL_SEARCH_RAW_TOOL_NAME).toBe('tool_search');
    const bridge = read('openclaw_runtime/src/agents/tool-search-capability-v3.ts');
    expect(bridge).toContain('runtime.callExactId');
    expect(bridge).toContain('params.runtime.search');
    expect(bridge).toContain('params.runtime.describe');
  });

  it('uses one descriptor schema and one canonical schema hash source', () => {
    const descriptorSource = read('openclaw_runtime/src/capabilities/v3/capability-descriptor.ts');
    expect(CAPABILITY_DESCRIPTOR_SCHEMA_VERSION).toBe('capability-descriptor/v1');
    expect(descriptorSource).toContain('canonicalizeMetadataValue');
    expect(descriptorSource).toContain('hashCapabilityMetadata');
    expect(descriptorSource).toContain('hashCapabilityDescriptor');
    const schema = { type: 'object', properties: { path: { type: 'string' } } };
    const one = hashCapabilityMetadata(schema);
    const two = hashCapabilityMetadata({ properties: { path: { type: 'string' } }, type: 'object' });
    expect(one).toBe(two);
    expect(one).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(canonicalizeMetadataValue(schema)).toBe(canonicalizeMetadataValue({ properties: { path: { type: 'string' } }, type: 'object' }));
  });

  it('deduplicates one capability id and resolves no duplicate schema identity', () => {
    const descriptors: CapabilityDescriptor[] = [
      ...CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS,
      {
        ...CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS[0]!,
        source: { ...CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS[0]!.source, provenance: 'duplicate-test' },
      },
    ];
    const catalog = buildCapabilityShadowCatalog(descriptors);
    expect(CAPABILITY_SHADOW_CATALOG_SCHEMA_VERSION).toBe('capability-shadow-catalog/v1');
    expect(catalog.diagnostics.some((item) => item.code === 'duplicate-capability-id')).toBe(true);
    const acceptedIds = catalog.descriptors.map((item) => item.capabilityId);
    expect(new Set(acceptedIds).size).toBe(acceptedIds.length);
    expect(acceptedIds).not.toContain(CAPABILITY_REGISTRY_V3_FIXTURE_DESCRIPTORS[0]!.capabilityId);
  });

  it('has a stable V3 baseline and records that it is not a benefit claim', () => {
    const baseline = evaluateCapabilityRegistryV3Baseline();
    expect(baseline.recallAt1).toEqual({ categoryAt1: 1, workflowNamespaceAt1: 1, capabilityAt1: 1 });
    const abProtocol = readJson<{ status: string; evidencePolicy: { humanEvidence: boolean; fixtureEvidence: string } }>(
      acceptanceDir + '/ab-protocol.json',
    );
    expect(abProtocol.status).toBe('frozen-before-live-run');
    expect(abProtocol.evidencePolicy.humanEvidence).toBe(false);
    expect(abProtocol.evidencePolicy.fixtureEvidence).toContain('never a benefit or graduation claim');
    const abReport = readJson<{ decision: { status: string }; summary: { benefitClaim: boolean; defaultChangeClaim: boolean } }>(
      acceptanceDir + '/ab-report.json',
    );
    expect(abReport.decision.status).toBe('insufficient-evidence');
    expect(abReport.summary.benefitClaim).toBe(false);
    expect(abReport.summary.defaultChangeClaim).toBe(false);
  });

  it('keeps the model capability profile contract tied to the same catalog identity', () => {
    const modelProfile = read('shared/model-capability-profile.ts');
    expect(modelProfile).toContain('COMPONENT_AUTHORITY_MANIFEST_VERSION');
    expect(modelProfile).toContain("MODEL_CAPABILITY_PROFILE_SCHEMA = 'ModelCapabilityProfile/v1'");
    expect(modelProfile).toContain('computeModelCapabilityStaticDigest');
    expect(modelProfile).toContain("'component.v3-capability-catalog': 'Capability discovery'");
    expect(COMPONENT_GRADUATION_PROFILE_SCHEMA).toBe('ComponentGraduationProfile/v1');
    expect(CAPABILITY_UNIFIED_RESOLVER_SCHEMA_VERSION).toBe('capability-unified-resolver/v1');
  });

  it('records no orphan V3 caller outside the explicit adapter/golden paths', () => {
    const consumers = read('shared/dcs/component-disposition-catalog.ts');
    expect(consumers).toContain("component.v3-capability-catalog");
    expect(consumers).toContain('TF-0502');
    const authority = read('shared/component-authority-manifest.ts');
    expect(authority).toContain("id: 'v3-capability-catalog'");
    expect(authority).toContain("id: 'tool-search-schema-expander'");
    expect(authority).toContain("id: 'skills-mcp-source-registry'");
  });
});
