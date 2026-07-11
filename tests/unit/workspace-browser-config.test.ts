import { describe, expect, it } from 'vitest';
import {
  isWebPreviewAnnotationAvailable,
  isWebPreviewAnnotationEnabled,
} from '@/components/file-preview/workspace-browser-config';

describe('workspace browser configuration', () => {
  it('enables component annotation only for development server previews', () => {
    expect(isWebPreviewAnnotationEnabled('devServer')).toBe(true);
    expect(isWebPreviewAnnotationEnabled('static')).toBe(false);
    expect(isWebPreviewAnnotationEnabled('externalUrl')).toBe(false);
    expect(isWebPreviewAnnotationEnabled(undefined)).toBe(false);
  });

  it('requires the selected mode and active runtime to both be development previews', () => {
    expect(isWebPreviewAnnotationAvailable('devServer', 'devServer', true)).toBe(true);
    expect(isWebPreviewAnnotationAvailable('devServer', 'externalUrl', true)).toBe(false);
    expect(isWebPreviewAnnotationAvailable('externalUrl', 'devServer', true)).toBe(false);
    expect(isWebPreviewAnnotationAvailable('devServer', 'devServer', false)).toBe(false);
  });
});
