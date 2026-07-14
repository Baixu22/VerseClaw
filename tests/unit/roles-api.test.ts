import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgencyRoleCandidatePayload,
  AgencyRolePromotionRecord,
  AgencyRoleReviewPayload,
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
  sourceRoot: string,
  draftId: string,
  candidate: AgencyRoleCandidatePayload,
): AgencyRoleReviewPayload {
  return {
    sourceRoot,
    draftId,
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
      effort: 'xhigh',
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
    const preview = await rolesApi.previewAgencyPromotion(
      reviewPayload(sourceRoot, draft.id, candidateFrom(draft.roleCandidate)),
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
    const payload = reviewPayload(sourceRoot, draft.id, candidateFrom(draft.roleCandidate));

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

  it('rejects changed sources and reconciles sanitized interrupted writes by exact digest', async () => {
    const sourceRoot = await createAgencyFixture();
    const { createRolesApi } = await import('@electron/services/roles-api');
    const rolesApi = createRolesApi();
    const catalog = await rolesApi.agencyCatalog({ sourceRoot });
    const draft = catalog.drafts[0]!;
    const reviewed = await rolesApi.reviewAgencyPromotion(
      reviewPayload(sourceRoot, draft.id, candidateFrom(draft.roleCandidate)),
    );

    await writeFile(
      join(sourceRoot, 'engineering', 'code-reviewer.md'),
      '# Code Reviewer\n\nChanged after review.',
    );
    const changed = await rolesApi.approveAgencyPromotion({
      reviewId: reviewed.record.id,
      reviewer: 'approver',
      comment: 'Should fail.',
    });
    expect(changed).toMatchObject({ success: false });
    expect(changed.error).toMatch(/source.*changed|fingerprint/i);

    await rm(sourceRoot, { recursive: true, force: true });
    const freshRoot = await createAgencyFixture();
    const freshCatalog = await rolesApi.agencyCatalog({ sourceRoot: freshRoot });
    const freshDraft = freshCatalog.drafts[0]!;
    const freshReview = await rolesApi.reviewAgencyPromotion(
      reviewPayload(freshRoot, freshDraft.id, candidateFrom(freshDraft.roleCandidate, {
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
    const reconciled = await rolesApi.agencyCatalog({ sourceRoot: freshRoot });
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

    const firstReview = await rolesApi.reviewAgencyPromotion(
      reviewPayload(sourceRoot, draft.id, candidateFrom(draft.roleCandidate)),
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
      reviewPayload(sourceRoot, draft.id, candidateFrom(draft.roleCandidate)),
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
