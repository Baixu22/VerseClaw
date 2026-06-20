// P5-2 CLI/TUI Deletion: CLI name resolver stub.
//
// The original `cli/cli-name.ts` was retired along with the `cli/`
// directory. This stub preserves the public surface used by
// `cli-runtime/command-format.ts` (and other gateway CLI-formatting
// helpers) so the gateway can format command examples after deletion.
export const DEFAULT_CLI_NAME = "openclaw";

export function resolveCliName(): string {
  return DEFAULT_CLI_NAME;
}

export function replaceCliName(command: string, _cliName: string = DEFAULT_CLI_NAME): string {
  // Replace any leading "openclaw" invocation with the default name. The
  // gateway never actually invokes a binary; this only formats help
  // text shown to operators, so a simple replace is sufficient.
  return command.replace(/\bopenclaw\b/g, _cliName);
}
