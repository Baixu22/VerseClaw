import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ScenarioIdSchema = Type.Union([
  Type.Literal('chat-empty'),
  Type.Literal('chat-streaming'),
  Type.Literal('models-heavy-usage'),
  Type.Literal('settings-provider-error'),
  Type.Literal('doctor-failed'),
  Type.Literal('gateway-connecting'),
  Type.Literal('knowledge-drafts'),
  Type.Literal('observability-trace-errors'),
]);

const JsonRecordSchema = Type.Record(Type.String(), Type.Unknown());

const SeedConversationSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  title: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  workspacePath: Type.Optional(Type.String()),
  messages: Type.Optional(Type.Array(Type.Unknown())),
}, { additionalProperties: false });

const SeedProviderSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  baseUrl: Type.Optional(Type.String()),
  apiProtocol: Type.Optional(Type.String()),
  hasApiKey: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const AgentDevVisualPresetSchema = Type.Partial(Type.Object({
  enabled: Type.Boolean(),
  width: Type.Number({ minimum: 1 }),
  height: Type.Number({ minimum: 1 }),
  theme: Type.Union([Type.Literal('light'), Type.Literal('dark')]),
  language: Type.Union([Type.Literal('en'), Type.Literal('zh'), Type.Literal('ja'), Type.Literal('ru')]),
  reducedMotion: Type.Boolean(),
  scenario: ScenarioIdSchema,
}, { additionalProperties: false }));

export const AgentDevSeedStatePayloadSchema = Type.Partial(Type.Object({
  scenario: ScenarioIdSchema,
  settings: JsonRecordSchema,
  conversations: Type.Array(SeedConversationSchema),
  providers: Type.Array(SeedProviderSchema),
  gatewayStatus: JsonRecordSchema,
  featureFlags: Type.Array(Type.String()),
  visual: AgentDevVisualPresetSchema,
  metadata: JsonRecordSchema,
}, { additionalProperties: false }));

export const AgentDevMockReplayConfigSchema = Type.Object({
  mode: Type.Union([Type.Literal('off'), Type.Literal('record'), Type.Literal('replay')]),
  fixtures: Type.Optional(Type.Array(Type.Object({
    module: Type.String({ minLength: 1 }),
    action: Type.String({ minLength: 1 }),
    payload: Type.Optional(Type.Unknown()),
    result: Type.Unknown(),
  }, { additionalProperties: false }))),
  clearCalls: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const AgentDevFeatureFlagsPayloadSchema = Type.Object({
  flags: Type.Optional(Type.Array(Type.String())),
  merge: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export type AgentDevSeedStatePayloadSchemaType = Static<typeof AgentDevSeedStatePayloadSchema>;
export type AgentDevMockReplayConfigSchemaType = Static<typeof AgentDevMockReplayConfigSchema>;
export type AgentDevFeatureFlagsPayloadSchemaType = Static<typeof AgentDevFeatureFlagsPayloadSchema>;

function formatValueErrors(schema: unknown, value: unknown): string {
  return [...Value.Errors(schema as never, value)]
    .slice(0, 5)
    .map((error) => `${error.path || '/'} ${error.message}`)
    .join('; ');
}

export function assertAgentDevSeedStatePayload(value: unknown): asserts value is AgentDevSeedStatePayloadSchemaType {
  if (!Value.Check(AgentDevSeedStatePayloadSchema, value ?? {})) {
    throw new Error(`Invalid agentDev.seedState payload: ${formatValueErrors(AgentDevSeedStatePayloadSchema, value ?? {})}`);
  }
}

export function assertAgentDevMockReplayConfig(value: unknown): asserts value is AgentDevMockReplayConfigSchemaType {
  if (!Value.Check(AgentDevMockReplayConfigSchema, value)) {
    throw new Error(`Invalid agentDev.configureMockReplay payload: ${formatValueErrors(AgentDevMockReplayConfigSchema, value)}`);
  }
}

export function assertAgentDevFeatureFlagsPayload(value: unknown): asserts value is AgentDevFeatureFlagsPayloadSchemaType {
  if (!Value.Check(AgentDevFeatureFlagsPayloadSchema, value ?? {})) {
    throw new Error(`Invalid agentDev.setFeatureFlags payload: ${formatValueErrors(AgentDevFeatureFlagsPayloadSchema, value ?? {})}`);
  }
}
