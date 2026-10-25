// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMemoryAuthorityManifest, validateMemoryAuthorityManifest } from '../../openclaw_runtime/src/memory/memory-authority';
import {
  DEFAULT_MEMORY_RUNTIME_CONFIG,
  RETIRED_MEMORY_INJECTION_FLAGS,
  createMemoryRuntimeConfig,
} from '../../openclaw_runtime/src/runtime-core/memory-runtime-config';
import {
  COMPASS_PRE_REPLY_INJECTION_RETIRED,
  buildPreReplyInjection,
} from '../../openclaw_runtime/src/runtime-core/memory-pre-reply-injection';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('TF-0500 Dreams surface is not a production route', () => {
  it('keeps the legacy /dreams route as a redirect-only retired surface', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('path="/dreams"');
    expect(app).toContain('<Route path="/dreams" element={<Navigate to="/" replace />} />');
    expect(app).not.toContain('pages/Dreams');
  });

  it('does not render a Dreams sidebar entry in any mode', () => {
    const sidebar = read('src/components/layout/Sidebar.tsx');
    expect(sidebar).not.toContain('sidebar-more-dreams');
    expect(sidebar).not.toContain('openClawDreams');
  });
});

describe('TF-0500 single accepted-memory authority', () => {
  it('maps every accepted data type to exactly one canonical store', () => {
    const manifest = buildMemoryAuthorityManifest();
    const canonical = manifest.storeBoundaries.filter((entry) => entry.canonicalForAcceptedMemory);
    const ownerOf = new Map<string, string>();
    for (const store of canonical) {
      for (const dataType of store.dataTypes) {
        const authority = manifest.entries.find((entry) => entry.dataType === dataType);
        if (!authority?.acceptedMemory) continue;
        const previous = ownerOf.get(dataType);
        expect(previous, dataType + ' is claimed by both ' + String(previous) + ' and ' + store.id).toBeUndefined();
        ownerOf.set(dataType, store.id);
      }
    }
    for (const entry of manifest.entries.filter((candidate) => candidate.acceptedMemory)) {
      expect(ownerOf.get(entry.dataType), entry.dataType + ' has no canonical accepted-memory store').toBeTruthy();
    }
  });

  it('validates the manifest and keeps a rollback for every migration mapping', () => {
    const manifest = buildMemoryAuthorityManifest();
    expect(validateMemoryAuthorityManifest(manifest).ok).toBe(true);
    expect(manifest.migrationMappings.length).toBeGreaterThan(0);
    for (const mapping of manifest.migrationMappings) {
      expect(String(mapping.rollback ?? '').trim(), mapping.id + ' needs a rollback path').not.toBe('');
      expect(mapping.removesSource, mapping.id + ' must not drop user data').toBe(false);
    }
  });
});

describe('TF-0500 parallel injection path is retired', () => {
  it('forces the retired injection flags off at the config factory', () => {
    expect(RETIRED_MEMORY_INJECTION_FLAGS).toEqual(['enableSessionStatePage', 'enablePreReplyRetrieval']);
    const config = createMemoryRuntimeConfig({
      featureFlags: {
        enableSessionStatePage: true,
        enablePreReplyRetrieval: true,
        enableEvidenceDiscipline: true,
      },
    });
    expect(config.featureFlags.enableSessionStatePage).toBe(false);
    expect(config.featureFlags.enablePreReplyRetrieval).toBe(false);
    expect(DEFAULT_MEMORY_RUNTIME_CONFIG.featureFlags.enableSessionStatePage).toBe(false);
    expect(DEFAULT_MEMORY_RUNTIME_CONFIG.featureFlags.enablePreReplyRetrieval).toBe(false);
    expect(config.featureFlags.enableEvidenceDiscipline).toBe(true);
  });

  it('never produces prompt text even when a hand-built config requests injection', async () => {
    expect(COMPASS_PRE_REPLY_INJECTION_RETIRED).toBe(true);
    const requested = {
      ...DEFAULT_MEMORY_RUNTIME_CONFIG,
      featureFlags: {
        ...DEFAULT_MEMORY_RUNTIME_CONFIG.featureFlags,
        enableSessionStatePage: true,
        enablePreReplyRetrieval: true,
      },
    };
    const result = await buildPreReplyInjection({
      sessionKey: 'agent:main:main',
      userInputText: 'what did we decide about the auth token ttl?',
      config: requested,
    });
    expect(result.sspString).toBeUndefined();
    expect(result.top5FactsString).toBeUndefined();
    expect(result.injectedFactIds ?? []).toHaveLength(0);
    expect(typeof result.pressureLevel).toBe('string');
  });
});