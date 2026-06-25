import { describe, expect, it } from 'vitest';
import {
  buildCronBrowserAutomationPrompt,
  parseCronBrowserAutomationPrompt,
} from '@shared/cron-browser-automation';

describe('cron browser automation prompt marker', () => {
  it('round-trips browser automation config through the prompt marker', () => {
    const prompt = buildCronBrowserAutomationPrompt({
      url: 'https://example.com/check-in',
      objective: 'Check in if needed and report the final status.',
      successCondition: 'The page says checked in for today.',
      failureCondition: 'Login is required or a captcha blocks the page.',
      template: 'checkIn',
      profile: 'work',
      authStateName: 'work-login',
      authPersistence: 'session-name',
      mode: 'headless',
      allowedDomains: ['example.com', 'auth.example.com'],
      sensitiveActionPolicy: 'draft-only',
      retryOnTransientFailure: true,
      diagnostics: {
        snapshot: true,
        console: true,
        errors: true,
        network: false,
        screenshot: true,
      },
    });

    expect(prompt).toContain('Use the agent_browser tool only');
    expect(prompt).toContain('connectionMode: managed');
    expect(prompt).toContain('Sensitive action policy: draft-only');
    expect(prompt).toContain('Success condition: The page says checked in for today.');
    expect(prompt).toContain('Failure condition: Login is required or a captcha blocks the page.');
    expect(prompt).toContain('Transient failure retry: if open/navigate/page-load/wait-for-selector fails');

    const parsed = parseCronBrowserAutomationPrompt(prompt);
    expect(parsed?.config).toMatchObject({
      url: 'https://example.com/check-in',
      objective: 'Check in if needed and report the final status.',
      successCondition: 'The page says checked in for today.',
      failureCondition: 'Login is required or a captcha blocks the page.',
      template: 'checkIn',
      profile: 'work',
      authStateName: 'work-login',
      authPersistence: 'session-name',
      mode: 'headless',
      allowedDomains: ['example.com', 'auth.example.com'],
      sensitiveActionPolicy: 'draft-only',
      retryOnTransientFailure: true,
      diagnostics: {
        snapshot: true,
        console: true,
        errors: true,
        network: false,
        screenshot: true,
      },
    });
  });

  it('rejects marker configs without a URL and objective', () => {
    expect(parseCronBrowserAutomationPrompt('plain scheduled prompt')).toBeNull();
    expect(() => buildCronBrowserAutomationPrompt({
      url: '',
      objective: '',
    })).toThrow(/URL and objective/);
  });
});
