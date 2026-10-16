/**
 * TF-0117: enforce the argument contract the tool catalog already advertises.
 *
 * Every entry in the catalog declares `additionalProperties: false`, but the
 * dispatcher used to read named fields off the raw `args` and ignore everything
 * else. That made the schema a promise the server did not keep, and turned a
 * caller's typo into silently different behaviour:
 *
 *   - `vb_snapshot { includeTxt: true }` returned a snapshot **without** text and
 *     reported success — the caller never learns its parameter was dropped;
 *   - `vb_click { selectors: '#b' }` failed with a driver error about an empty
 *     CSS selector that never mentions `selectors`;
 *   - unknown keys passed through unvalidated, which is a latent injection path
 *     for any future handler that spreads `args`.
 *
 * Deliberately catalog-agnostic (the catalog is passed in) so this module has no
 * import cycle with `server.ts` and is unit-testable without spawning a server.
 */

export type ArgumentSchemaCarrier = {
  name: string;
  inputSchema: Record<string, unknown>;
};

/** Argument names a tool accepts, from its `inputSchema.properties`. */
export function acceptedArguments(tools: readonly ArgumentSchemaCarrier[], name: string): string[] {
  const tool = tools.find((entry) => entry.name === name);
  const properties = (tool?.inputSchema as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  return properties ? Object.keys(properties) : [];
}

/**
 * Argument names the tool does not declare. Empty for an unknown tool — the
 * capability gate rejects unknown tools before argument validation is relevant.
 */
export function validateArguments(
  tools: readonly ArgumentSchemaCarrier[],
  name: string,
  args: Record<string, unknown>,
): string[] {
  const accepted = acceptedArguments(tools, name);
  if (accepted.length === 0) return [];
  return Object.keys(args).filter((key) => !accepted.includes(key));
}
