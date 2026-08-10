// Runtime tool fixture for QA-lab suite flows. The fixture body is provided by
// the QA flow environment; this module keeps the static contract available so
// suite-runtime-flow can wire it without a hard dependency on an external
// fixture bundle.
export type RuntimeToolFixtureDeps = Record<string, (...args: never[]) => unknown>;

export async function runRuntimeToolFixture(
  env: unknown,
  _config: Record<string, unknown>,
  deps: RuntimeToolFixtureDeps,
): Promise<unknown> {
  const readEffectiveTools = deps.readEffectiveTools as
    | ((env: unknown, sessionKey: string) => Promise<unknown>)
    | undefined;
  return readEffectiveTools?.(env, "");
}
