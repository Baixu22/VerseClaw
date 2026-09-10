// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveContextInjectionMode } from '../../openclaw_runtime/src/agents/bootstrap-files';

describe('P1-5 contextInjection default', () => {
  it('defaults to continuation-skip when no config is supplied', () => {
    expect(resolveContextInjectionMode(undefined)).toBe('continuation-skip');
  });

  it('defaults to continuation-skip when config omits contextInjection', () => {
    expect(resolveContextInjectionMode({ agents: {} })).toBe('continuation-skip');
  });

  it('honors an explicit agent-level contextInjection', () => {
    const cfg = {
      agents: {
        list: [{ id: 'main', contextInjection: 'always' }],
      },
    };
    expect(resolveContextInjectionMode(cfg as never, 'main')).toBe('always');
  });

  it('honors explicit defaults-level contextInjection', () => {
    const cfg = {
      agents: {
        defaults: { contextInjection: 'never' },
      },
    };
    expect(resolveContextInjectionMode(cfg as never)).toBe('never');
  });

  it('agent-level setting beats defaults-level', () => {
    const cfg = {
      agents: {
        defaults: { contextInjection: 'continuation-skip' },
        list: [{ id: 'main', contextInjection: 'always' }],
      },
    };
    expect(resolveContextInjectionMode(cfg as never, 'main')).toBe('always');
  });
});
