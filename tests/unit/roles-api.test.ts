import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgencyRoleCandidatePayload,
  AgencyRolePromotionRecord,
  AgencyRoleReviewPayload,
  RoleConfigEffort,
} from '@shared/host-api/contract';

const {
  storeDocuments,
  testHome,
  testUserData,
  writeConfigState,
} = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  const root = process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`;
  return {
    storeDocuments: new Map<string, Record<string, unknown>>(),
    testHome: `${root}/clawx-roles-api-${suffix}`,
    testUserData: `${root}/clawx-roles-api-user-data-${suffix}`,
    writeConfigState: {
      afterWriteError: '' as string,
      beforeWrite: undefined as undefined | (() => void),
    },
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
    getAppPath: () => process.env.CLAWX_TEST_TMPDIR ?? `${process.cwd()}/.tmp/vitest`,
  },
}));

vi.mock('@electron/utils/logger', () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('electron-store', () => {
  class MockStore<T extends Record<string, unknown>> {
    private readonly document: Record<string, unknown>;

    constructor(options: { name?: string; defaults?: T }) {
      const name = options.name ?? 'default';
      const existing = storeDocuments.get(name);
      this.document = existing ?? structuredClone(options.defaults ?? {});
      storeDocuments.set(name, this.document);
    }

    get<K extends keyof T>(key: K): T[K] {
      return this.document[key as string] as T[K];
    }

    set<K extends keyof T>(key: K, value: T[K]): void {
      this.document[key as string] = structuredClone(value);
    }
  }

  return { default: MockStore };
});

vi.mock('@electron/utils/channel-config', async () => {
  const actual = await vi.importActual<typeof import('@electron/utils/channel-config')>(
    '@electron/utils/channel-config',
  );
  return {
    ...actual,
    writeOpenClawConfig: async (...args: Parameters<typeof actual.writeOpenClawConfig>) => {
      writeConfigState.beforeWrite?.();
      await actual.writeOpenClawConfig(...args);
      if (writeConfigState.afterWriteError) {
        throw new Error(writeConfigState.afterWriteError);
      }
    },
  };
});

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function createAgencyFixture(): Promise<string> {
  const root = join(testHome, 'agency-fixture');
  await mkdir(join(root, 'engineering'), { recursive: true });
  await mkdir(join(root, 'strategy'), { recursive: true });
  await writeFile(join(root, 'divisions.json'), JSON.stringify({
    divisions: {
      engineering: { name: 'Engineering' },
    },
  }));
  await writeFile(join(root, 'tools.json'), JSON.stringify({ tools: {} }));
  await writeFile(join(root, 'strategy', 'runbooks.json'), JSON.stringify({ runbooks: [] }));
  await writeFile(join(root, 'engineering', 'code-reviewer.md'), [
    '---',
    'name: Code Reviewer',
    'description: Reviews code with bounded evidence.',
    '---',
    '# Code Reviewer Agent',
    '',
    'Review code and report findings.',
  ].join('\n'));
  return root;
}

function candidateFrom(
  roleCandidate: AgencyRoleCandidatePayload,
  patch: Partial<AgencyRoleCandidatePayload> = {},
): AgencyRoleCandidatePayload {
  return {
    ...roleCandidate,
    name: 'agency-code-reviewer',
    tags: ['review'],
    ...patch,
  };
}

function reviewPayload(
  packageId: string,
  candidate: AgencyRoleCandidatePayload,
): AgencyRoleReviewPayload {
  return {
    packageId,
    reviewer: 'release-operator',
    candidate,
    toolHintDispositions: [],
    evidenceQualification: 'scenario-verified',
    evidenceRefs: ['artifact://agency-role/code-reviewer'],
    comment: 'Reviewed against the bounded scenario.',
  };
}

function promotionRecords(): AgencyRolePromotionRecord[] {
  const document = storeDocuments.get('agency-role-promotions');
  return structuredClone(
    (document?.records as AgencyRolePromotionRecord[] | undefined) ?? [],
  );
}

describe('roles host API', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    storeDocuments.clear();
    writeConfigState.afterWriteError = '';
    writeConfigState.beforeWrite = undefined;
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('creates a config-backed role in agents.roles', async () => {
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();

    const result = await rolesApi.upsertConfigRole({
      name: 'research-helper',
      displayName: 'Research Helper',
      description: 'Collects bounded context.',
      rolePrompt: 'Help review sources and report uncertainty.',
      tools: ['read', 'search'],
      effort: 'medium',
      permissions: {
        filesystem: 'read',
        network: 'limited',
        commands: [],
      },
      tags: ['research', 'review'],
    });

    expect(result).toMatchObject({
      success: true,
      role: {
        name: 'research-helper',
        displayName: 'Research Helper',
        origin: 'config',
      },
      pendingRuntimeRefresh: true,
    });

    const config = await readOpenClawJson();
    expect(config).toMatchObject({
      agents: {
        roles: [
          expect.objectContaining({
            name: 'research-helper',
            displayName: 'Research Helper',
            rolePrompt: 'Help review sources and report uncertainty.',
            tools: ['read', 'search'],
            effort: 'medium',
            permissions: {
              filesystem: 'read',
              network: 'limited',
              commands: [],
            },
            tags: ['research', 'review'],
          }),
        ],
      },
    });
  });

  it('edits an existing config role without duplicating it', async () => {
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();

    await rolesApi.upsertConfigRole({
      name: 'research-helper',
      displayName: 'Research Helper',
      rolePrompt: 'Initial prompt.',
      tools: [],
      effort: 'low',
      permissions: { filesystem: 'read', network: 'none', commands: [] },
      tags: [],
    });
    const result = await rolesApi.upsertConfigRole({
      name: 'research-helper',
      displayName: 'Research Helper Updated',
      rolePrompt: 'Updated prompt.',
      tools: ['read'],
      effort: 'high',
      permissions: { filesystem: 'write', network: 'limited', commands: ['pnpm test'] },
      tags: ['updated'],
    });

    expect(result.role.displayName).toBe('Research Helper Updated');
    const config = await readOpenClawJson();
    const roles = ((config.agents as Record<string, unknown>).roles ?? []) as Array<Record<string, unknown>>;
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({
      name: 'research-helper',
      displayName: 'Research Helper Updated',
      rolePrompt: 'Updated prompt.',
      effort: 'high',
      tags: ['updated'],
    });
  });

  it('rejects invalid role payloads before writing config', async () => {
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();

    await expect(rolesApi.upsertConfigRole({
      name: 'Bad Name',
      displayName: 'Bad',
      rolePrompt: 'Prompt',
      tools: [],
      effort: 'medium',
      permissions: { filesystem: 'read', network: 'limited', commands: [] },
      tags: [],
    })).rejects.toThrow('Role name must match');

    await expect(rolesApi.upsertConfigRole({
      name: 'valid-role',
      displayName: '',
      rolePrompt: 'Prompt',
      tools: [],
      effort: 'medium',
      permissions: { filesystem: 'read', network: 'limited', commands: [] },
      tags: [],
    })).rejects.toThrow('displayName is required');

    await expect(rolesApi.upsertConfigRole({
      name: 'valid-role',
      displayName: 'Valid',
      rolePrompt: '',
      tools: [],
      effort: 'medium',
      permissions: { filesystem: 'read', network: 'limited', commands: [] },
      tags: [],
    })).rejects.toThrow('rolePrompt is required');

    await expect(rolesApi.upsertConfigRole({
      name: 'valid-role',
      displayName: 'Valid',
      rolePrompt: 'Prompt',
      tools: [],
      // Intentionally invalid: this test proves runtime validation rejects it.
      effort: 'xhigh' as RoleConfigEffort,
      permissions: { filesystem: 'read', network: 'limited', commands: [] },
      tags: [],
    })).rejects.toThrow('effort must be one of');
  });

  it('does not allow a config role to overwrite a built-in role', async () => {
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();

    await expect(rolesApi.upsertConfigRole({
      name: 'architect',
      displayName: 'Architect Override',
      rolePrompt: 'Override built-in.',
      tools: [],
      effort: 'medium',
      permissions: { filesystem: 'read', network: 'limited', commands: [] },
      tags: [],
    })).rejects.toThrow('Cannot overwrite built-in role');
  });

  it('validates an explicit Agency repository and keeps preview side-effect free', async () => {
    const sourceRoot = await createAgencyFixture();
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();

    const catalog = await rolesApi.agencyCatalog({ sourceRoot });
    expect(catalog).toMatchObject({
      success: true,
      reviews: [],
      drafts: [{
        status: 'draft',
        sourceRef: {
          relativePath: 'engineering/code-reviewer.md',
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      }],
    });

    const draft = catalog.drafts[0]!;
    const imported = await rolesApi.importAgencyPackage({ sourceRoot, draftId: draft.id });
    expect(imported.package).toMatchObject({
      packageId: expect.stringMatching(/^[a-f0-9]{64}$/),
      completeness: 'complete',
      draft: { id: draft.id },
    });
    expect((await rolesApi.listAgencyPackages()).packages).toHaveLength(1);
    const preview = await rolesApi.previewAgencyPromotion(
      reviewPayload(imported.package.packageId, candidateFrom(draft.roleCandidate)),
    );
    expect(preview).toMatchObject({
      success: true,
      persisted: false,
      validation: { ok: true, issues: [] },
      contractSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      role: {
        name: 'agency-code-reviewer',
        tools: [],
        origin: 'config',
      },
    });
    expect(promotionRecords()).toEqual([]);
    await expect(readOpenClawJson()).rejects.toThrow();

    const missing = await rolesApi.agencyCatalog({ sourceRoot: join(sourceRoot, 'missing') });
    expect(missing).toMatchObject({ success: false });
    expect(missing.error).toMatch(/repository|directory/i);

    await rm(join(sourceRoot, 'tools.json'));
    const incomplete = await rolesApi.agencyCatalog({ sourceRoot });
    expect(incomplete).toMatchObject({ success: false });
    expect(incomplete.error).toMatch(/tools\.json/i);
  });

  it('persists review without config and approval pending before idempotent materialization', async () => {
    const sourceRoot = await createAgencyFixture();
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();
    const catalog = await rolesApi.agencyCatalog({ sourceRoot });
    const draft = catalog.drafts[0]!;
    const imported = await rolesApi.importAgencyPackage({ sourceRoot, draftId: draft.id });
    const payload = reviewPayload(imported.package.packageId, candidateFrom(draft.roleCandidate));

    const reviewed = await rolesApi.reviewAgencyPromotion(payload);
    expect(reviewed).toMatchObject({
      success: true,
      pendingRuntimeRefresh: false,
      record: {
        lifecycle: 'reviewed',
        materialization: { status: 'not-started' },
      },
    });
    await expect(readOpenClawJson()).rejects.toThrow();

    writeConfigState.beforeWrite = () => {
      expect(promotionRecords()).toEqual([
        expect.objectContaining({
          id: reviewed.record.id,
          decision: 'approved',
          materialization: { status: 'pending' },
        }),
      ]);
    };
    const approved = await rolesApi.approveAgencyPromotion({
      reviewId: reviewed.record.id,
      reviewer: 'approver',
      comment: 'Approved for bounded runtime use.',
    });
    expect(approved).toMatchObject({
      success: true,
      pendingRuntimeRefresh: true,
      record: {
        id: reviewed.record.id,
        lifecycle: 'active',
        decision: 'approved',
        materializedRoleName: 'agency-code-reviewer',
        materialization: { status: 'complete' },
      },
    });

    const repeated = await rolesApi.approveAgencyPromotion({
      reviewId: reviewed.record.id,
      reviewer: 'approver',
      comment: 'Idempotent retry.',
    });
    expect(repeated.record.id).toBe(reviewed.record.id);
    expect(promotionRecords()).toHaveLength(1);
    const config = await readOpenClawJson();
    const roles = ((config.agents as Record<string, unknown>).roles ?? []) as Array<Record<string, unknown>>;
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({
      name: 'agency-code-reviewer',
      tags: expect.arrayContaining([
        `agency-contract:${reviewed.record.contractSha256.slice(0, 12)}`,
      ]),
    });
  });

  it('previews reviewed memory proposals only for an exact active complete package', async () => {
    const sourceRoot = await createAgencyFixture();
    await writeFile(join(sourceRoot, 'engineering', 'code-reviewer.md'), [
      '---',
      'name: Code Reviewer',
      'description: Reviews code with bounded evidence.',
      '---',
      '# Code Reviewer Agent',
      '',
      '## Identity',
      'You are a legendary reviewer.',
      '',
      '## Critical Rules',
      'Never approve a change without evidence.',
      '',
      '```bash',
      'pnpm install',
      '```',
      '',
      '## Workflow',
      '1. Read the diff.',
      '2. Verify each finding.',
      '',
      '## Tools',
      'Run `pnpm test` with shell access.',
    ].join('\n'));
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();
    const draft = (await rolesApi.agencyCatalog({ sourceRoot })).drafts[0]!;
    const imported = await rolesApi.importAgencyPackage({ sourceRoot, draftId: draft.id });
    const reviewed = await rolesApi.reviewAgencyPromotion(
      reviewPayload(imported.package.packageId, candidateFrom(draft.roleCandidate)),
    );

    await expect(rolesApi.previewAgencyMemoryProposals({
      packageId: imported.package.packageId,
      reviewId: reviewed.record.id,
    })).rejects.toThrow(/active|complete/i);

    const active = await rolesApi.approveAgencyPromotion({
      reviewId: reviewed.record.id,
      reviewer: 'approver',
      comment: 'Approve exact role.',
    });
    const preview = await rolesApi.previewAgencyMemoryProposals({
      packageId: imported.package.packageId,
      reviewId: active.record.id,
    });

    expect(preview).toMatchObject({
      success: true,
      packageId: imported.package.packageId,
      reviewId: active.record.id,
      materializedRoleName: 'agency-code-reviewer',
      candidates: [
        {
          type: 'constraint',
          headingPath: ['Critical Rules'],
          content: 'Never approve a change without evidence.',
          sectionId: expect.stringMatching(/^[a-f0-9]{64}$/),
          proposal: {
            type: 'constraint',
            scope: 'role',
            scopeKey: 'agency-code-reviewer',
            roleTags: ['agency-code-reviewer'],
            ownerRole: 'agency-code-reviewer',
            applicableRoles: ['agency-code-reviewer'],
            content: 'Never approve a change without evidence.',
            confidence: 0.6,
            importance: 0.8,
            sensitivity: 'normal',
            durability: 'long_term',
            source: 'system',
            evidenceRefs: [{
              type: 'file',
              ref: expect.stringMatching(/agency-role-packages.+source\.md$/),
              excerpt: 'Never approve a change without evidence.',
            }],
          },
        },
        {
          type: 'procedure',
          headingPath: ['Workflow'],
          proposal: {
            confidence: 0.6,
            importance: 0.65,
          },
        },
      ],
    });
    expect(JSON.stringify(preview.candidates)).not.toMatch(
      /legendary|pnpm install|shell access/i,
    );

    await expect(rolesApi.previewAgencyMemoryProposals({
      packageId: 'f'.repeat(64),
      reviewId: active.record.id,
    })).rejects.toThrow(/package|match|found/i);
    await expect(rolesApi.previewAgencyMemoryProposals({
      packageId: imported.package.packageId,
      reviewId: 'missing-review',
    })).rejects.toThrow(/review|found/i);

    await rolesApi.retireAgencyPromotion({
      reviewId: active.record.id,
      reviewer: 'approver',
      comment: 'Retire exact role.',
    });
    await expect(rolesApi.previewAgencyMemoryProposals({
      packageId: imported.package.packageId,
      reviewId: active.record.id,
    })).rejects.toThrow(/active|complete/i);
  });

  it('fails closed when the reviewed local package is tampered', async () => {
    const sourceRoot = await createAgencyFixture();
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();
    const draft = (await rolesApi.agencyCatalog({ sourceRoot })).drafts[0]!;
    const imported = await rolesApi.importAgencyPackage({ sourceRoot, draftId: draft.id });
    await writeFile(
      join(
        testHome,
        '.verse-claw',
        'agency-role-packages',
        'v1',
        imported.package.packageId,
        'source.md',
      ),
      'tampered',
    );

    await expect(rolesApi.previewAgencyPromotion(
      reviewPayload(imported.package.packageId, candidateFrom(draft.roleCandidate)),
    )).rejects.toThrow(/integrity|hash/i);
  });

  it('migrates legacy reviews to reconstructed packages before removing sourceRoot', async () => {
    const sourceRoot = await createAgencyFixture();
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();
    const draft = (await rolesApi.agencyCatalog({ sourceRoot })).drafts[0]!;
    const imported = await rolesApi.importAgencyPackage({ sourceRoot, draftId: draft.id });
    const reviewed = await rolesApi.reviewAgencyPromotion(
      reviewPayload(imported.package.packageId, candidateFrom(draft.roleCandidate)),
    );
    const document = storeDocuments.get('agency-role-promotions')!;
    const legacy = structuredClone((document.records as Array<Record<string, unknown>>)[0]!);
    delete legacy.packageId;
    legacy.sourceRoot = sourceRoot;
    document.records = [legacy];
    await rm(
      join(testHome, '.verse-claw', 'agency-role-packages'),
      { recursive: true, force: true },
    );

    vi.resetModules();
    const migratedApi = (await import('@electron/services/roles-api')).createRolesApi();
    const local = await migratedApi.listAgencyPackages();

    expect(local.packages).toEqual([
      expect.objectContaining({ completeness: 'legacy-reconstructed' }),
    ]);
    expect(local.reviews).toEqual([
      expect.objectContaining({
        id: reviewed.record.id,
        packageId: local.packages[0]!.packageId,
      }),
    ]);
    expect(promotionRecords()[0]).not.toHaveProperty('sourceRoot');

    await rm(sourceRoot, { recursive: true, force: true });
    const migratedActive = await migratedApi.approveAgencyPromotion({
      reviewId: reviewed.record.id,
      reviewer: 'approver',
      comment: 'Approve reconstructed review.',
    });
    expect(migratedActive).toMatchObject({
      success: true,
      record: { lifecycle: 'active' },
    });
    await expect(migratedApi.previewAgencyMemoryProposals({
      packageId: local.packages[0]!.packageId,
      reviewId: migratedActive.record.id,
    })).rejects.toThrow(/complete archived source snapshot/i);
  });

  it('rejects memory proposals after the exact materialized role is replaced', async () => {
    const sourceRoot = await createAgencyFixture();
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();
    const draft = (await rolesApi.agencyCatalog({ sourceRoot })).drafts[0]!;
    const imported = await rolesApi.importAgencyPackage({ sourceRoot, draftId: draft.id });
    const reviewed = await rolesApi.reviewAgencyPromotion(
      reviewPayload(imported.package.packageId, candidateFrom(draft.roleCandidate)),
    );
    const active = await rolesApi.approveAgencyPromotion({
      reviewId: reviewed.record.id,
      reviewer: 'approver',
      comment: 'Approve exact role.',
    });

    await rolesApi.upsertConfigRole({
      ...active.record.candidate,
      displayName: 'User Replacement',
      tags: ['user-authored'],
    });

    await expect(rolesApi.previewAgencyMemoryProposals({
      packageId: imported.package.packageId,
      reviewId: active.record.id,
    })).rejects.toThrow(/exact materialized role contract/i);
  });

  it('approves from the local package after source deletion and reconciles interrupted writes', async () => {
    const sourceRoot = await createAgencyFixture();
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();
    const catalog = await rolesApi.agencyCatalog({ sourceRoot });
    const draft = catalog.drafts[0]!;
    const imported = await rolesApi.importAgencyPackage({ sourceRoot, draftId: draft.id });
    const reviewed = await rolesApi.reviewAgencyPromotion(
      reviewPayload(imported.package.packageId, candidateFrom(draft.roleCandidate)),
    );

    await writeFile(
      join(sourceRoot, 'engineering', 'code-reviewer.md'),
      '# Code Reviewer\n\nChanged after review.',
    );
    await rm(sourceRoot, { recursive: true, force: true });
    const approvedWithoutSource = await rolesApi.approveAgencyPromotion({
      reviewId: reviewed.record.id,
      reviewer: 'approver',
      comment: 'Approve from immutable local package.',
    });
    expect(approvedWithoutSource).toMatchObject({
      success: true,
      record: { lifecycle: 'active', packageId: imported.package.packageId },
    });

    const freshRoot = await createAgencyFixture();
    const freshCatalog = await rolesApi.agencyCatalog({ sourceRoot: freshRoot });
    const freshDraft = freshCatalog.drafts[0]!;
    const freshPackage = await rolesApi.importAgencyPackage({
      sourceRoot: freshRoot,
      draftId: freshDraft.id,
    });
    const freshReview = await rolesApi.reviewAgencyPromotion(
      reviewPayload(freshPackage.package.packageId, candidateFrom(freshDraft.roleCandidate, {
        name: 'agency-recovery-reviewer',
      })),
    );
    writeConfigState.afterWriteError = `secret=${testHome}\\tokens\\provider-key`;
    const failed = await rolesApi.approveAgencyPromotion({
      reviewId: freshReview.record.id,
      reviewer: 'approver',
      comment: 'Exercise recovery.',
    });
    expect(failed).toMatchObject({
      success: false,
      record: {
        lifecycle: 'reviewed',
        materialization: { status: 'failed' },
      },
    });
    expect(failed.record.materialization.error).not.toContain(testHome);
    expect(failed.record.materialization.error).not.toContain('provider-key');

    writeConfigState.afterWriteError = '';
    const reconciled = await rolesApi.listAgencyPackages();
    expect(reconciled.reviews).toEqual([
      expect.objectContaining({
        id: freshReview.record.id,
        lifecycle: 'active',
        materialization: { status: 'complete' },
      }),
      expect.anything(),
    ]);
  });

  it('retires only the exact materialized digest and preserves audit history', async () => {
    const sourceRoot = await createAgencyFixture();
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();
    const catalog = await rolesApi.agencyCatalog({ sourceRoot });
    const draft = catalog.drafts[0]!;
    const imported = await rolesApi.importAgencyPackage({ sourceRoot, draftId: draft.id });

    const firstReview = await rolesApi.reviewAgencyPromotion(
      reviewPayload(imported.package.packageId, candidateFrom(draft.roleCandidate)),
    );
    const active = await rolesApi.approveAgencyPromotion({
      reviewId: firstReview.record.id,
      reviewer: 'approver',
      comment: 'Approve.',
    });
    const retired = await rolesApi.retireAgencyPromotion({
      reviewId: active.record.id,
      reviewer: 'approver',
      comment: 'Retire exact materialization.',
    });
    expect(retired).toMatchObject({
      success: true,
      pendingRuntimeRefresh: true,
      record: {
        lifecycle: 'retired',
        decision: 'retired',
        materialization: { status: 'complete' },
      },
    });
    expect(promotionRecords()).toEqual([
      expect.objectContaining({ id: active.record.id, lifecycle: 'retired' }),
    ]);
    const configAfterRetire = await readOpenClawJson();
    expect(((configAfterRetire.agents as Record<string, unknown>).roles as unknown[])).toEqual([]);

    const secondReview = await rolesApi.reviewAgencyPromotion(
      reviewPayload(imported.package.packageId, candidateFrom(draft.roleCandidate)),
    );
    const secondActive = await rolesApi.approveAgencyPromotion({
      reviewId: secondReview.record.id,
      reviewer: 'approver',
      comment: 'Approve replacement test.',
    });
    await rolesApi.upsertConfigRole({
      ...secondReview.record.candidate,
      displayName: 'User Replacement',
      tags: ['user-authored'],
    });
    const guarded = await rolesApi.retireAgencyPromotion({
      reviewId: secondActive.record.id,
      reviewer: 'approver',
      comment: 'Must not remove replacement.',
    });
    expect(guarded).toMatchObject({ success: false });
    expect(guarded.error).toMatch(/exact|digest|replacement/i);
    expect(promotionRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: secondActive.record.id,
        lifecycle: 'active',
      }),
    ]));
    const replacementConfig = await readOpenClawJson();
    const replacementRoles = ((replacementConfig.agents as Record<string, unknown>).roles ?? []) as Array<Record<string, unknown>>;
    expect(replacementRoles).toEqual([
      expect.objectContaining({
        name: 'agency-code-reviewer',
        displayName: 'User Replacement',
        tags: ['user-authored'],
      }),
    ]);
  });
});
