import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({ ...base, testMatch: 'project-rag-packaged-smoke.spec.ts',
  testIgnore: [], workers: 1, retries: 0 });
