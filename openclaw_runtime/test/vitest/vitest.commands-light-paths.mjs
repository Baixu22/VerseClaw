// Test routing map for lightweight command tests and their source triggers.
const normalizeRepoPath = (value) => value.replaceAll("\\", "/");

const commandsLightEntries = [];

const commandsLightIncludePatternByFile = new Map(
  commandsLightEntries.flatMap(({ source, test }) =>
    source
      ? [
          [source, test],
          [test, test],
        ]
      : [[test, test]],
  ),
);

export const commandsLightSourceFiles = commandsLightEntries.flatMap(({ source }) =>
  source ? [source] : [],
);
export const commandsLightTestFiles = commandsLightEntries.map(({ test }) => test);

export function isCommandsLightTarget(file) {
  return commandsLightIncludePatternByFile.has(normalizeRepoPath(file));
}

export function isCommandsLightTestFile(file) {
  return commandsLightTestFiles.includes(normalizeRepoPath(file));
}

export function resolveCommandsLightIncludePattern(file) {
  return commandsLightIncludePatternByFile.get(normalizeRepoPath(file)) ?? null;
}
