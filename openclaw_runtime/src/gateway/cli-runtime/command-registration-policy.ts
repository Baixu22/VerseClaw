import { isTruthyEnvValue } from "../../infra/env.js";

export function shouldEagerRegisterSubcommands(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isTruthyEnvValue(env.OPENCLAW_DISABLE_LAZY_SUBCOMMANDS);
}
