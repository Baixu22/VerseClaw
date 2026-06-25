export type RemoteTaskKind = 'message' | 'doctor' | 'settingsPatch';
export type RemoteTaskStatus = 'pending' | 'pendingApproval' | 'running' | 'completed' | 'failed' | 'rejected';
export type RemoteTaskSource = 'local' | 'relay' | 'channel' | 'api';

export type RemoteTaskMessageCommand = {
  kind: 'message';
  title: string;
  body: string;
};

export type RemoteTaskDoctorCommand = {
  kind: 'doctor';
  mode: 'diagnose' | 'fix';
};

export type RemoteTaskSettingsPatch = Partial<{
  theme: 'light' | 'dark' | 'system';
  language: string;
  gatewayAutoStart: boolean;
  telemetryEnabled: boolean;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;
  cdpRemoteControlEnabled: boolean;
  cdpRemoteDebuggingPort: number;
}>;

export type RemoteTaskSettingsPatchCommand = {
  kind: 'settingsPatch';
  patch: RemoteTaskSettingsPatch;
};

export type RemoteTaskCommand =
  | RemoteTaskMessageCommand
  | RemoteTaskDoctorCommand
  | RemoteTaskSettingsPatchCommand;

export type RemoteTaskRecord = {
  id: string;
  source: RemoteTaskSource;
  status: RemoteTaskStatus;
  command: RemoteTaskCommand;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | null;
  completedAt?: string | null;
  resultSummary?: string;
  error?: string;
};

export type RemoteTaskPreviewChange = {
  key: string;
  before: unknown;
  after: unknown;
};

export type RemoteTaskPreview = {
  requiresApproval: boolean;
  changes: RemoteTaskPreviewChange[];
};

export type RemoteTaskSnapshot = {
  tasks: RemoteTaskRecord[];
  generatedAt: string;
};
