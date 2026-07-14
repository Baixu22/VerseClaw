/**
 * 极简 schema builder —— 保留 Agent Reach shadow 的 Schema 调用形状，
 * 内部使用 OpenClaw 的 TypeBox 与 flat string enum。
 */
import { Type, type TSchema } from 'typebox';
import { stringEnum as openClawStringEnum } from 'openclaw/plugin-sdk/channel-actions';

export type SchemaDescriptor = TSchema;

export const Schema = {
  string(description?: string): TSchema {
    return Type.String(description ? { description } : {});
  },
  integer(opts: { description?: string; minimum?: number } = {}): TSchema {
    return Type.Integer(opts);
  },
  boolean(description?: string): TSchema {
    return Type.Boolean(description ? { description } : {});
  },
  array(items: TSchema, description?: string): TSchema {
    return Type.Array(items, description ? { description } : {});
  },
  enum(values: readonly string[], description?: string): TSchema {
    return openClawStringEnum(values, description ? { description } : {});
  },
  optional(inner: TSchema): TSchema {
    return Type.Optional(inner);
  },
  object(properties: Record<string, TSchema>, description?: string): TSchema {
    return Type.Object(properties, {
      additionalProperties: false,
      ...(description ? { description } : {}),
    });
  },
};

export function stringEnum(
  values: readonly string[],
  opts: { description?: string } = {},
): TSchema {
  return openClawStringEnum(values, opts);
}
