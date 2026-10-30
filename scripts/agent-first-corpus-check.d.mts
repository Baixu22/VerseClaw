import type { checkCorpus } from './lib/agent-first-task-corpus.mjs';
export function checkAgentFirstCorpus(root?: string): ReturnType<typeof checkCorpus> & { schemaVersion: string; driven_by: string; actor: string; scope: string };
