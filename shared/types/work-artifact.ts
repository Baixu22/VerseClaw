/** Agent declared artifact capability */
export type ArtifactKind =
  | 'document.write'
  | 'sheet.write'
  | 'sheet.read'
  | 'csv.read'
  | 'slide.write'
  | 'pdf.validate'
  | 'html.generate'
  | 'web.extract'
  | 'web.search';

/** Artifact deliverable status */
export type ArtifactStatus = 'pending' | 'generating' | 'ready' | 'invalid' | 'validationError' | 'error';

/** Single artifact description */
export interface WorkArtifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  filePath: string;
  fileName: string;
  ext: string;
  mimeType: string;
  status: ArtifactStatus;
  description?: string;
  createdAt: number;
  size?: number;
  validation?: {
    valid: boolean;
    error?: string;
    details?: Record<string, unknown>;
    previewAvailable?: boolean;
  };
  sourceMessageId?: string;
  htmlContent?: string;
}

/** Artifact action */
export type ArtifactAction =
  | { type: 'preview' }
  | { type: 'validate' }
  | { type: 'openFolder' }
  | { type: 'export'; as: ArtifactKind }
  | { type: 'revise' };

export interface ArtifactPanelArtifactState {
  artifacts: WorkArtifact[];
  selectedArtifactId: string | null;
  generating: boolean;
}
