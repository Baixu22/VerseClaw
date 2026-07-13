/* eslint-disable react-hooks/rules-of-hooks -- fixture file: useLegacy is a synthetic name for AST patch planner tests, not a real React hook */
export function nested(input: string) {
  return useLegacy(useLegacy(input));
}

