import type { WorkspacePreviewMode } from './types/workspace';

export function isWebPreviewAnnotationEnabled(mode: WorkspacePreviewMode | undefined): boolean {
  return mode === 'devServer';
}

export function isWebPreviewAnnotationAvailable(
  selectedMode: WorkspacePreviewMode | undefined,
  runtimeMode: WorkspacePreviewMode | undefined,
  running: boolean | undefined,
): boolean {
  return Boolean(
    running
    && isWebPreviewAnnotationEnabled(selectedMode)
    && isWebPreviewAnnotationEnabled(runtimeMode),
  );
}
