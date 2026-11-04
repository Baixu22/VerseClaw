// RC-03 pre-seal producer registrations. COMPASS SSP, ContextEngine message
// replacement, and every DCS semantic injection are registered here BEFORE the
// bundle seal; none may remain a direct provider-bound bypass. Post-seal
// non-semantic transport transforms register separately.
import { isSealProducerRegistered, registerSealProducer, type SealProducerRegistration } from './seal-registry.js';

export const RC03_PRE_SEAL_PRODUCERS = {
  compassSsp: 'compass-ssp',
  cvkMessageReplacement: 'cvk-message-replacement',
  dcsKnowledge: 'dcs-knowledge',
  dcsWorkingMemory: 'dcs-working-memory',
  dcsToolRegistry: 'dcs-tool-registry',
  cvkSystemPromptAddition: 'cvk-system-prompt-addition',
  roleMemoryInjection: 'role-memory-injection',
  vtokenPacker: 'vtoken-packer',
  memoryPilotInjection: 'memory-pilot-injection',
  compactionSummarizer: 'compaction-summarizer',
  compassRetrieval: 'compass-retrieval',
  roleSpawnMemoryPack: 'role-spawn-memory-pack',
  embeddedSystemPrompt: 'embedded-system-prompt',
  sessionStart: 'session-start-injection',
  btwSideQuestion: 'btw-side-question',
} as const;

const preSealRegistrations: SealProducerRegistration[] = [
  {
    id: RC03_PRE_SEAL_PRODUCERS.compassSsp,
    mutates: 'system_prompt',
    kind: 'semantic',
    purpose: 'COMPASS self-sustaining-prompt (SSP) produced by buildPreReplyInjection; must run before the bundle seal.',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.cvkMessageReplacement,
    mutates: 'messages',
    kind: 'semantic',
    purpose: 'ContextEngine message replacement (attempt.ts assembledMessages swap and ownsCompaction engine loop); must run before the bundle seal.',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.dcsKnowledge,
    mutates: 'messages',
    kind: 'semantic',
    purpose: 'DCS knowledge block injection (assembler #appendKnowledge -> knowledge channel).',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.dcsWorkingMemory,
    mutates: 'messages',
    kind: 'semantic',
    purpose: 'DCS working-memory injection (assembler #appendWorkingMemory -> working_memory channel).',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.dcsToolRegistry,
    mutates: 'messages',
    kind: 'semantic',
    purpose: 'DCS tool-registry injection (assembler #appendToolRegistry -> tool_registry channel).',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.cvkSystemPromptAddition,
    mutates: 'system_prompt',
    kind: 'semantic',
    purpose: 'CVK systemPromptAddition collected into the candidate collection (channel cvk_addition).',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.roleMemoryInjection,
    mutates: 'messages',
    kind: 'semantic',
    purpose: 'Role-memory injection in subagent sessions (assembler role_memory handler).',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.vtokenPacker,
    mutates: 'system_prompt',
    kind: 'semantic',
    purpose: 'VToken assembly output injected as context candidates.',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.memoryPilotInjection,
    mutates: 'system_prompt',
    kind: 'semantic',
    purpose: 'Runtime Memory inject-pilot output collected by the Context Orchestrator (memory_pilot channel); must run before the bundle seal.',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.compactionSummarizer,
    mutates: 'messages',
    kind: 'semantic',
    purpose: 'Compaction summarizer request (SUMMARIZATION_SYSTEM_PROMPT + serialized transcript). It bypasses the Context Orchestrator, so it is sealed at the stream boundary before transport serialization.',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.compassRetrieval,
    mutates: 'system_prompt',
    kind: 'semantic',
    purpose: 'COMPASS pre-reply hybrid-retrieval top-5 facts (get-reply-run extraSystemPromptParts); attributed by content at the seal.',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.roleSpawnMemoryPack,
    mutates: 'system_prompt',
    kind: 'semantic',
    purpose: 'Role Memory ContextPack rendered into a role-spawned subagent system prompt (role-spawn buildRoleSystemPrompt); attributed by content at the seal.',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.embeddedSystemPrompt,
    mutates: 'system_prompt',
    kind: 'semantic',
    purpose: 'Attempt system prompt builder (attempt.ts buildAttemptSystemPrompt, provider transform, pre-loop hook overrides); owns every system-prompt byte not attributed to a narrower producer. Its digest is bound at the seal.',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.sessionStart,
    mutates: 'system_prompt',
    kind: 'semantic',
    purpose: 'Session-start plan projected through the existing Context Orchestrator candidate collection.',
    version: '1',
  },
  {
    id: RC03_PRE_SEAL_PRODUCERS.btwSideQuestion,
    mutates: 'system_prompt',
    kind: 'semantic',
    purpose: 'Ephemeral BTW side-question prompt and sanitized conversation sealed by the BTW entry before provider execution.',
    version: '1',
  },
];

export const RC03_POST_SEAL_TRANSFORMS = {
  providerHeaders: 'transport-provider-headers',
  wireSerialization: 'transport-wire-serialization',
  cacheBoundaryStrip: 'transport-cache-boundary-strip',
} as const;

const postSealRegistrations: SealProducerRegistration[] = [
  {
    id: RC03_POST_SEAL_TRANSFORMS.cacheBoundaryStrip,
    mutates: 'transport',
    kind: 'non-semantic',
    purpose:
      'The prompt-cache boundary marker is removed before the bytes leave: stripSystemPromptCacheBoundary in the stream transformContext, joinSystemPromptWithoutCacheBoundary in the OpenAI transports and the provider-owned hand-over, plus the enforceNoOutboundCacheBoundary gate. No semantic text changes.',
    version: '1',
  },
  {
    id: RC03_POST_SEAL_TRANSFORMS.providerHeaders,
    mutates: 'transport',
    kind: 'non-semantic',
    purpose: 'Provider-specific header injection after the seal; does not touch systemPrompt/messages.',
    version: '1',
  },
  {
    id: RC03_POST_SEAL_TRANSFORMS.wireSerialization,
    mutates: 'transport',
    kind: 'non-semantic',
    purpose: 'Final wire serialization/stream flag after the seal; does not touch semantic content.',
    version: '1',
  },
];

/** Register every RC-03 producer. Idempotent within a process. */
export function registerRc03SealProducers(): void {
  for (const registration of [...preSealRegistrations, ...postSealRegistrations]) {
    if (!isSealProducerRegistered(registration.id)) {
      registerSealProducer(registration);
    }
  }
}

export function rc03PreSealProducerIds(): readonly string[] {
  return preSealRegistrations.map((r) => r.id);
}

export function rc03PostSealTransformIds(): readonly string[] {
  return postSealRegistrations.map((r) => r.id);
}
