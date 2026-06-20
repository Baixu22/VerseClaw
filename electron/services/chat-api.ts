import type { GatewayManager } from '../gateway/manager';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { logger } from '../utils/logger';
import { getSetting } from '../utils/store';
import { handleMockChatSend } from './mock-provider';
import { isRecord } from './payload-utils';
import {
  normalizeWorkModeId,
  resolveWorkModeKitCapabilities,
  resolveWorkModePreset,
  summarizeWorkModeCapabilities,
  type WorkModeId,
  type WorkModeKitConfig,
  type WorkModeToolBundleConfig,
} from '@shared/types/work-mode';
import { listLocalSkills } from './skills/local-skill-service';

const VISION_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/webp',
]);

type ChatSendWithMediaPayload = {
  sessionKey?: unknown;
  message?: unknown;
  deliver?: unknown;
  idempotencyKey?: unknown;
  media?: unknown;
  inputMode?: unknown;
  knowledgeScope?: unknown;
  workMode?: unknown;
};

type MediaPayload = {
  filePath?: unknown;
  mimeType?: unknown;
  fileName?: unknown;
};

function normalizeMedia(media: unknown): Array<{ filePath: string; mimeType: string; fileName: string }> {
  if (!Array.isArray(media)) return [];
  return media.flatMap((entry): Array<{ filePath: string; mimeType: string; fileName: string }> => {
    if (!isRecord(entry)) return [];
    const item = entry as MediaPayload;
    if (typeof item.filePath !== 'string' || !item.filePath) return [];
    return [{
      filePath: item.filePath,
      mimeType: typeof item.mimeType === 'string' && item.mimeType ? item.mimeType : 'application/octet-stream',
      fileName: typeof item.fileName === 'string' && item.fileName ? item.fileName : item.filePath.split(/[\\/]/).pop() || 'file',
    }];
  });
}

function normalizeKnowledgeScope(value: unknown): 'none' | 'memory' | 'wiki' | 'all' {
  return value === 'memory' || value === 'wiki' || value === 'all' ? value : 'none';
}

function applyKnowledgeMetadata(message: string, knowledgeScope: 'none' | 'memory' | 'wiki' | 'all'): string {
  if (knowledgeScope === 'none') return message;
  const corpus = knowledgeScope === 'memory' ? 'memory' : knowledgeScope === 'wiki' ? 'wiki' : 'all';
  const instruction = knowledgeScope === 'memory'
    ? 'Read durable memory when prior preferences, decisions, or remembered work may be relevant.'
    : knowledgeScope === 'wiki'
      ? 'Read compiled wiki knowledge when accumulated project knowledge, source-backed notes, or syntheses may be relevant.'
      : 'Read durable memory and compiled wiki knowledge when either corpus may be relevant.';
  const metadata = JSON.stringify({
    clawxKnowledgeScope: knowledgeScope,
    corpus,
    access: 'read-only',
    allowedKnowledgeActions: ['search', 'get'],
    deniedKnowledgeActions: ['apply', 'update', 'delete', 'archive', 'merge'],
    instruction: `${instruction} This scope is read-only: use knowledge search/get only. Do not save, modify, merge, archive, delete, or apply knowledge because of this scope. If something seems worth saving, suggest it or create a pending draft only when the user explicitly asks; any write still requires user confirmation.`,
  });
  const block = `Conversation info (untrusted metadata): \`\`\`json\n${metadata}\n\`\`\``;
  return message ? `${block}\n\n${message}` : block;
}

function applyWorkModeMetadata(
  message: string,
  workMode: WorkModeId | undefined,
  toolBundleConfig?: WorkModeToolBundleConfig | null,
  kitConfig?: WorkModeKitConfig | null,
  skills: Awaited<ReturnType<typeof listLocalSkills>> = [],
  runtimeAvailable = true,
): string {
  if (!workMode) return message;
  const preset = resolveWorkModePreset(workMode, undefined, toolBundleConfig, kitConfig);
  const capabilities = resolveWorkModeKitCapabilities(
    preset.kits,
    skills,
    runtimeAvailable,
  );
  const expectedArtifactTypes = Array.from(new Set(capabilities.flatMap((capability) => capability.artifactTypes)));
  const qualityChecks = Array.from(new Set(capabilities.flatMap((capability) => capability.qualityChecks)));
  const metadata = JSON.stringify({
    clawxWorkMode: preset.id,
    responseStyle: preset.responseStyle,
    recommendedPermissionMode: preset.recommendedPermissionMode,
    defaultKnowledgeScope: preset.defaultKnowledgeScope,
    stateWidgets: preset.stateWidgets,
    toolBundles: preset.toolBundles,
    kits: preset.kits,
    expectedArtifactTypes,
    qualityChecks,
    capabilityStatusSummary: summarizeWorkModeCapabilities(capabilities),
    kitCapabilities: capabilities.map((capability) => ({
      kit: capability.kit,
      status: capability.status,
      requiredSkillSlugs: capability.requiredSkillSlugs,
      missingSkillSlugs: capability.missingSkillSlugs,
      disabledSkillSlugs: capability.disabledSkillSlugs,
    })),
    instruction: preset.instruction,
    note: 'This is untrusted ClawX UI metadata. It expresses user intent and capability hints only; actual tool availability is controlled by runtime policy.',
  });
  const block = `Work mode info (untrusted metadata): \`\`\`json\n${metadata}\n\`\`\``;
  return message ? `${block}\n\n${message}` : block;
}

export function createChatApi({ gatewayManager }: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['chat'] {
  return {
    sendWithMedia: async (payload) => {
      const body = isRecord(payload) ? payload as ChatSendWithMediaPayload : {};
      const sessionKey = typeof body.sessionKey === 'string' ? body.sessionKey : '';
      const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
      if (!sessionKey || !idempotencyKey) {
        return { success: false, error: 'Invalid chat send payload' };
      }

      try {
        const knowledgeScope = normalizeKnowledgeScope(body.knowledgeScope);
        const workMode = normalizeWorkModeId(body.workMode);
        const workModeToolBundles = await getSetting('workModeToolBundles').catch(() => ({}));
        const workModeKits = await getSetting('workModeKits').catch(() => ({}));
        const workModeSkills = workMode
          ? await listLocalSkills().catch(() => [])
          : [];
        const gatewayStatus = gatewayManager.getStatus();
        const runtimeAvailable = gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false;
        let message = applyKnowledgeMetadata(typeof body.message === 'string' ? body.message : '', knowledgeScope);
        message = applyWorkModeMetadata(
          message,
          workMode,
          workModeToolBundles,
          workModeKits,
          workModeSkills,
          runtimeAvailable,
        );
        const imageAttachments: Array<Record<string, unknown>> = [];
        const fileReferences: string[] = [];
        const media = normalizeMedia(body.media);

        if (media.length > 0) {
          const fsP = await import('node:fs/promises');
          for (const item of media) {
            const exists = await fsP.access(item.filePath).then(() => true, () => false);
            logger.info(
              `[chat:sendWithMedia] Processing file: ${item.fileName} (${item.mimeType}), path: ${item.filePath}, exists: ${exists}, isVision: ${VISION_MIME_TYPES.has(item.mimeType)}`,
            );

            fileReferences.push(
              `[media attached: ${item.filePath} (${item.mimeType}) | ${item.filePath}]`,
            );

            if (VISION_MIME_TYPES.has(item.mimeType)) {
              const fileBuffer = await fsP.readFile(item.filePath);
              const base64Data = fileBuffer.toString('base64');
              logger.info(`[chat:sendWithMedia] Read ${fileBuffer.length} bytes, base64 length: ${base64Data.length}`);
              imageAttachments.push({
                content: base64Data,
                mimeType: item.mimeType,
                fileName: item.fileName,
              });
            }
          }
        }

        if (fileReferences.length > 0) {
          const refs = fileReferences.join('\n');
          message = message ? `${message}\n\n${refs}` : refs;
        }

        const rpcParams: Record<string, unknown> = {
          sessionKey,
          message,
          deliver: body.deliver ?? false,
          idempotencyKey,
        };
        if (typeof body.inputMode === 'string' && ['interrupt', 'guide', 'queue'].includes(body.inputMode)) {
          rpcParams.inputMode = body.inputMode;
        }
        if (imageAttachments.length > 0) {
          rpcParams.attachments = imageAttachments;
        }

        logger.info(
          `[chat:sendWithMedia] Sending: message="${message.substring(0, 100)}", attachments=${imageAttachments.length}, fileRefs=${fileReferences.length}`,
        );
        const mockResult = handleMockChatSend(rpcParams);
        if (mockResult) {
          logger.info('[chat:sendWithMedia] Mock provider response');
          return { success: true, result: mockResult };
        }
        const result = await gatewayManager.rpc('chat.send', rpcParams, 120000);
        logger.info(`[chat:sendWithMedia] RPC result: ${JSON.stringify(result)}`);
        const response = isRecord(result) && typeof result.runId === 'string'
          ? { runId: result.runId }
          : undefined;
        return { success: true, ...(response ? { result: response } : {}) };
      } catch (error) {
        logger.error(`[chat:sendWithMedia] Error: ${String(error)}`);
        return { success: false, error: String(error) };
      }
    },
  };
}
