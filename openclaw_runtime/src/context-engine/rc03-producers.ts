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
    mutates: 'tool-schema',
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
    mutates: 'messages',
    kind: 'semantic',
    purpose: 'VToken assembly output injected as context candidates.',
    version: '1',
  },
];

export const RC03_POST_SEAL_TRANSFORMS = {
  providerHeaders: 'transport-provider-headers',
  wireSerialization: 'transport-wire-serialization',
} as const;

const postSealRegistrations: SealProducerRegistration[] = [
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
