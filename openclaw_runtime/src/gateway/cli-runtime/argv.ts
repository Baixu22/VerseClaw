import {
  consumeRootOptionToken,
  FLAG_TERMINATOR,
} from "../../infra/cli-root-options.js";

const HELP_FLAGS = new Set(["-h", "--help"]);
const VERSION_FLAGS = new Set(["-V", "--version", "-v"]);

export function getCommandPathWithRootOptions(argv: string[], depth = 2): string[] {
  const args = argv.slice(2);
  const commandPath: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === FLAG_TERMINATOR) {
      break;
    }
    const consumed = consumeRootOptionToken(args, index);
    if (consumed > 0) {
      index += consumed - 1;
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    commandPath.push(arg);
    if (commandPath.length >= depth) {
      break;
    }
  }
  return commandPath;
}

export function getPrimaryCommand(argv: string[]): string | null {
  return getCommandPathWithRootOptions(argv, 1)[0] ?? null;
}

export function isHelpOrVersionInvocation(argv: string[]): boolean {
  return argv.slice(2).some((arg) => HELP_FLAGS.has(arg) || VERSION_FLAGS.has(arg));
}

export function isRootHelpInvocation(argv: string[]): boolean {
  const args = argv.slice(2);
  let hasHelp = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg || arg === FLAG_TERMINATOR) {
      break;
    }
    if (HELP_FLAGS.has(arg)) {
      hasHelp = true;
      continue;
    }
    const consumed = consumeRootOptionToken(args, index);
    if (consumed > 0) {
      index += consumed - 1;
      continue;
    }
    return false;
  }
  return hasHelp;
}

export function buildParseArgv(params: {
  programName?: string;
  rawArgs?: string[];
  fallbackArgv?: string[];
}): string[] {
  const source =
    params.rawArgs?.length
      ? params.rawArgs
      : params.fallbackArgv?.length
        ? params.fallbackArgv
        : process.argv;
  if (source.length >= 2 && /(?:^|[\\/])(?:node|bun)(?:\.exe)?$/iu.test(source[0] ?? "")) {
    return source;
  }
  return ["node", params.programName || "openclaw", ...source];
}
