/**
 * 极简 schema builder —— typebox 替身。
 *
 * 形状对齐 typebox 的 Type.Object/String/Integer/Boolean/Array/Optional，
 * 仅供 shadow 项目零依赖运行。迁移到 ClawX 时把所有 schema 调用换成：
 *   import { Type } from "typebox";
 * 并删除本文件。ClawX 用法见 openclaw_runtime/src/agents/tools/web-fetch.ts。
 */

export interface SchemaDescriptor {
  type: 'object' | 'string' | 'integer' | 'boolean' | 'array' | 'enum' | 'optional' | 'any';
  description?: string;
  items?: SchemaDescriptor;
  properties?: Record<string, SchemaDescriptor>;
  enumValues?: readonly string[];
  default?: unknown;
  minimum?: number;
}

export const Schema = {
  string(description?: string): SchemaDescriptor {
    return { type: 'string', description };
  },
  integer(opts: { description?: string; minimum?: number } = {}): SchemaDescriptor {
    return { type: 'integer', description: opts.description, minimum: opts.minimum };
  },
  boolean(description?: string): SchemaDescriptor {
    return { type: 'boolean', description };
  },
  array(items: SchemaDescriptor, description?: string): SchemaDescriptor {
    return { type: 'array', items, description };
  },
  enum(values: readonly string[], description?: string): SchemaDescriptor {
    return { type: 'enum', enumValues: values, description };
  },
  optional(inner: SchemaDescriptor): SchemaDescriptor {
    return { type: 'optional', items: inner, description: inner.description };
  },
  object(properties: Record<string, SchemaDescriptor>, description?: string): SchemaDescriptor {
    return { type: 'object', properties, description };
  },
};

/** stringEnum —— 对齐 ClawX openclaw_runtime/src/agents/schema/string-enum.ts。 */
export function stringEnum(values: readonly string[], opts: { description?: string } = {}): SchemaDescriptor {
  return Schema.enum(values, opts.description);
}
