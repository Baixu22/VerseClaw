// @vitest-environment node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DCS_PROD_FLAGS } from '../../shared/dcs/prod-flags-catalog';
import {
  AUTHORITY_COMPONENTS,
  COMPONENT_AUTHORITY_DOMAINS,
  COMPONENT_AUTHORITY_MANIFEST,
  COMPONENT_AUTHORITY_MANIFEST_VERSION,
  DEFAULT_MATRIX_AUTHORITY_LINKS,
  PRODUCT_SURFACE_AUTHORITY_LINKS,
  buildComponentAuthorityProfile,
  validateComponentAuthorityManifest,
  type ComponentAuthorityAssignment,
  type ComponentAuthorityDefinition,
  type ComponentAuthorityManifest,
} from '../../shared/component-authority-manifest';

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function mutableManifest(): ComponentAuthorityManifest {
  return structuredClone(COMPONENT_AUTHORITY_MANIFEST) as ComponentAuthorityManifest;
}


function mutableAuthorities(manifest: ComponentAuthorityManifest): ComponentAuthorityAssignment[] {
  return manifest.authorities as ComponentAuthorityAssignment[];
}

function authority(
  manifest: ComponentAuthorityManifest,
  dataType: string,
  scope: ComponentAuthorityAssignment['scope'],
  operation: ComponentAuthorityAssignment['operation'],
): ComponentAuthorityAssignment {
  const found = manifest.authorities.find((entry) =>
    entry.dataType === dataType && entry.scope === scope && entry.operation === operation,
  );
  if (!found) throw new Error(`missing authority ${dataType} ${scope} ${operation}`);
  return found;
}

function component(manifest: ComponentAuthorityManifest, id: string): ComponentAuthorityDefinition {
  const found = manifest.components.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing component ${id}`);
  return found as ComponentAuthorityDefinition;
}

function collectSourceFiles(dir: string): string[] {
  const start = path.join(root, dir);
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) visit(fullPath);
      else if (/\.(ts|tsx)$/u.test(entry)) files.push(fullPath);
    }
  };
  visit(start);
  return files;
}

describe('component authority manifest', () => {
  it('keeps every component mapped to at least one domain and every domain owned', () => {
    expect(COMPONENT_AUTHORITY_MANIFEST.schemaVersion).toBe(COMPONENT_AUTHORITY_MANIFEST_VERSION);
    expect(validateComponentAuthorityManifest()).toEqual({ ok: true, issues: [] });
    expect(new Set(AUTHORITY_COMPONENTS.map((entry) => entry.id)).size).toBe(AUTHORITY_COMPONENTS.length);

    const claimedDomains = new Set(AUTHORITY_COMPONENTS.flatMap((entry) => entry.domains));
    expect([...claimedDomains].sort()).toEqual([...COMPONENT_AUTHORITY_DOMAINS].sort());
    for (const member of AUTHORITY_COMPONENTS) {
      expect(member.domains.length, member.id).toBeGreaterThan(0);
      expect(member.purpose.trim(), member.id).not.toBe('');
      expect(member.runtimeAvailabilitySource.trim(), member.id).not.toBe('');
      expect(member.sourceAnchors.length, member.id).toBeGreaterThan(0);
    }
  });

  it('maps every existing DCS flag to exactly one component', () => {
    const mapped = AUTHORITY_COMPONENTS.flatMap((entry) => entry.catalogFlagIds ?? []);
    expect(mapped).toHaveLength(DCS_PROD_FLAGS.length);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual(DCS_PROD_FLAGS.map((entry) => entry.id).sort());
  });

  it('preserves the Context, Memory, Knowledge, Capability, Execution, Browser and Observability separations', () => {
    const contextAuthority = component(COMPONENT_AUTHORITY_MANIFEST, 'dcs-context-authority');
    expect(contextAuthority.allowedWrites).toEqual(['context.candidate-set', 'context.prompt-plan']);
    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'dcs-assembler-compat-adapter').allowedWrites).toEqual([]);
    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'provider-request-guard').ownedDataTypes).toEqual(['context.request-envelope']);

    expect(authority(COMPONENT_AUTHORITY_MANIFEST, 'memory.runtime-fact', 'session', 'update').authorityComponentId).toBe('runtime-memory-store');
    expect(authority(COMPONENT_AUTHORITY_MANIFEST, 'memory.role-card', 'workspace', 'accept').authorityComponentId).toBe('role-memory-card-governance');
    expect(authority(COMPONENT_AUTHORITY_MANIFEST, 'memory.candidate', 'session', 'update').authorityComponentId).toBe('memory-candidate-queue');
    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'memory-candidate-queue').forbiddenActions).toContain('accept-fact-as-durable-memory');

    expect(authority(COMPONENT_AUTHORITY_MANIFEST, 'knowledge.applied', 'workspace', 'accept').authorityComponentId).toBe('knowledge-review-authority');
    expect(authority(COMPONENT_AUTHORITY_MANIFEST, 'knowledge.sekb-candidate', 'workspace', 'update').authorityComponentId).toBe('sekb-candidate-provider');
    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'sekb-candidate-provider').forbiddenActions).toContain('apply-knowledge');

    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'v3-capability-catalog').forbiddenActions).toContain('own-executor-closure');
    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'coding-execution-backend').authorizationRole).toBe('consumer');
    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'coding-execution-backend').effects).not.toContain('authorize');
    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'permission-approval-authority').authorizationRole).toBe('owner');

    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'browser-session-owner').id).not.toBe(component(COMPONENT_AUTHORITY_MANIFEST, 'browser-task-projection-owner').id);
    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'browser-session-owner').authorizationRole).toBe('consumer');
    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'observability-recorder').effects).toEqual(['record', 'update']);
    expect(component(COMPONENT_AUTHORITY_MANIFEST, 'observability-recorder').forbiddenActions).toContain('authorize-tool-use');
  });

  it('rejects a second accepted-memory writer', () => {
    const manifest = mutableManifest();
    const original = authority(manifest, 'memory.role-card', 'workspace', 'accept');
    mutableAuthorities(manifest).push({ ...original, authorityComponentId: 'runtime-memory-store' });
    const result = validateComponentAuthorityManifest(manifest);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate_authority');
  });

  it('rejects a second context assembly owner', () => {
    const manifest = mutableManifest();
    const original = authority(manifest, 'context.prompt-plan', 'turn', 'accept');
    mutableAuthorities(manifest).push({ ...original, authorityComponentId: 'dcs-assembler-compat-adapter' });
    const result = validateComponentAuthorityManifest(manifest);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate_authority');
  });

  it('rejects a second domain executor', () => {
    const manifest = mutableManifest();
    const original = authority(manifest, 'execution.tool-effect', 'run', 'execute');
    mutableAuthorities(manifest).push({ ...original, authorityComponentId: 'browser-session-owner' });
    const result = validateComponentAuthorityManifest(manifest);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate_authority');
  });

  it('rejects permission escalation and unauthorized cross-domain writes', () => {
    const manifest = mutableManifest();
    const renderer = component(manifest, 'renderer-ui-surface');
    renderer.authorizationRole = 'owner';
    renderer.effects = [...renderer.effects, 'authorize'];
    renderer.allowedWrites = ['memory.role-card'];
    const result = validateComponentAuthorityManifest(manifest);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'permission_escalation',
      'unauthorized_cross_domain_write',
      'permission_owner_count',
    ]));
  });

  it('cross-checks the product semantic and default-config surfaces', () => {
    const semantics = read('docs/clawx-product-semantics.md');
    const componentSection = semantics.split('<!-- FP-P1-08-COMPONENT-STATUS-START -->')[1]
      ?.split('<!-- FP-P1-08-COMPONENT-STATUS-END -->')[0];
    expect(componentSection).toBeDefined();
    const productLabels = componentSection!
      .split(/\r?\n/u)
      .filter((line) => /^\| [^|-].*\| `[^`]+` \|/u.test(line))
      .map((line) => line.split('|')[1]?.trim())
      .filter((label): label is string => Boolean(label));
    expect(productLabels).toHaveLength(Object.keys(PRODUCT_SURFACE_AUTHORITY_LINKS).length);
    expect(Object.keys(PRODUCT_SURFACE_AUTHORITY_LINKS).sort()).toEqual([...productLabels].sort());

    const defaultMatrix = read('docs/dev/default-config-matrix.md');
    const defaultLabels = defaultMatrix
      .split(/\r?\n/u)
      .map((line) => /^\|\s*\*\*(.+?)\*\*\s*\|/u.exec(line)?.[1]?.trim())
      .filter((label): label is string => Boolean(label));
    expect(defaultLabels).toHaveLength(Object.keys(DEFAULT_MATRIX_AUTHORITY_LINKS).length);
    expect(Object.keys(DEFAULT_MATRIX_AUTHORITY_LINKS).sort()).toEqual([...defaultLabels].sort());

    const componentIds = new Set(AUTHORITY_COMPONENTS.map((entry) => entry.id));
    for (const linked of [
      ...Object.values(PRODUCT_SURFACE_AUTHORITY_LINKS),
      ...Object.values(DEFAULT_MATRIX_AUTHORITY_LINKS),
    ].flat()) {
      expect(componentIds.has(linked), linked).toBe(true);
    }
  });

  it('keeps every declared source anchor present in the current tree with exact path case', () => {
    const assertExactPathCase = (relativePath: string): void => {
      let current = root;
      for (const segment of relativePath.split('/')) {
        expect(readdirSync(current), `${relativePath}: missing exact segment ${segment}`).toContain(segment);
        current = path.join(current, segment);
      }
    };
    for (const member of AUTHORITY_COMPONENTS) {
      for (const sourceAnchor of member.sourceAnchors) {
        assertExactPathCase(sourceAnchor.path);
        const fullPath = path.join(root, sourceAnchor.path);
        expect(existsSync(fullPath), `${member.id}: ${sourceAnchor.path}`).toBe(true);
        if (sourceAnchor.contains) {
          expect(read(sourceAnchor.path), `${member.id}: ${sourceAnchor.path}`).toContain(sourceAnchor.contains);
        }
      }
    }
  });

  it('documents the machine manifest in runtime-control-planes.md', () => {
    const doc = read('docs/dev/runtime-control-planes.md');
    expect(doc).toContain('shared/component-authority-manifest.ts');
    expect(doc).toContain('ComponentAuthorityManifest/v1');
    expect(doc).toContain('ComponentAuthorityProfile/v1');
    for (const domain of COMPONENT_AUTHORITY_DOMAINS) expect(doc).toContain(domain);
  });

  it('guards renderer transport against direct Gateway, IPC and domain-store access', () => {
    const files = [...collectSourceFiles('src/pages'), ...collectSourceFiles('src/components')];
    const forbidden = [
      /window\.electron\.ipcRenderer\.invoke/u,
      /\bipcRenderer\.invoke\s*\(/u,
      /127\.0\.0\.1:18789/u,
      /localhost:18789/u,
      /\bnew\s+WebSocket\s*\(/u,
    ];
    const violations = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return forbidden.flatMap((pattern) => pattern.test(text) ? [`${path.relative(root, file)} matched ${pattern.source}`] : []);
    });
    expect(violations).toEqual([]);
  });

  it('builds a static and effective model-safe component profile', () => {
    const profile = buildComponentAuthorityProfile();
    expect(profile.schemaVersion).toBe('ComponentAuthorityProfile/v1');
    expect(profile.staticManifestVersion).toBe(COMPONENT_AUTHORITY_MANIFEST_VERSION);
    expect(profile.entries).toHaveLength(AUTHORITY_COMPONENTS.length);
    expect(profile.modelSafeSummary).toHaveLength(AUTHORITY_COMPONENTS.length);

    const effective = buildComponentAuthorityProfile(AUTHORITY_COMPONENTS.map((member) => ({
      componentId: member.id,
      availability: 'disabled' as const,
      source: 'unit-test:effective-state',
      reason: 'not enabled for this test turn',
    })));
    expect(effective.entries.every((entry) => entry.effectiveAvailability === 'disabled')).toBe(true);
    expect(effective.entries.every((entry) => entry.effectiveSource === 'unit-test:effective-state')).toBe(true);

    expect(() => buildComponentAuthorityProfile([{
      componentId: 'not-a-component',
      availability: 'disabled',
      source: 'unit-test',
    }])).toThrow('Unknown component effective state');
  });
});