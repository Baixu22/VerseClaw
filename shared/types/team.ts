export type TeamTemplateMode = 'router' | 'lead-workers' | 'adversarial-review';

export type TeamTemplateRoleBinding = {
  roleName: string;
  required: boolean;
  modelRef?: string | null;
};

export type TeamTemplate = {
  id: string;
  name: string;
  description: string;
  mode: TeamTemplateMode;
  roles: TeamTemplateRoleBinding[];
  defaultLeadRole: string;
  verifierRole?: string;
  tags: string[];
};

export type TeamTemplateSnapshot = {
  templates: TeamTemplate[];
  defaultTemplateId: string;
};
