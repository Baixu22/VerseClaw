// Test routing globs and predicates for UI unit tests.
export const unitUiIncludePatterns = [
  "ui/src/ui/chat/**/*.test.ts",
];

export function isUnitUiTestTarget(relative) {
  if (!relative.endsWith(".test.ts")) {
    return false;
  }
  return relative.startsWith("ui/src/ui/chat/");
}

export function isUiTestTarget(relative) {
  return (
    relative.startsWith("ui/src/") &&
    relative.endsWith(".test.ts") &&
    !relative.endsWith(".e2e.test.ts")
  );
}
