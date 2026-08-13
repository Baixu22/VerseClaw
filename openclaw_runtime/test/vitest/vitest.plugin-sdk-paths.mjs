// Test routing map for lightweight plugin SDK tests and source triggers.
const normalizeRepoPath = (value) => value.replaceAll("\\", "/");

const pluginSdkLightEntries = [];

const pluginSdkLightIncludePatternByFile = new Map(
  pluginSdkLightEntries.flatMap(({ source, test }) => [
    [source, test],
    [test, test],
  ]),
);

export const pluginSdkLightSourceFiles = pluginSdkLightEntries.map(({ source }) => source);
export const pluginSdkLightTestFiles = pluginSdkLightEntries.map(({ test }) => test);

export function isPluginSdkLightTarget(file) {
  return pluginSdkLightIncludePatternByFile.has(normalizeRepoPath(file));
}

export function isPluginSdkLightTestFile(file) {
  return pluginSdkLightTestFiles.includes(normalizeRepoPath(file));
}

export function resolvePluginSdkLightIncludePattern(file) {
  return pluginSdkLightIncludePatternByFile.get(normalizeRepoPath(file)) ?? null;
}
