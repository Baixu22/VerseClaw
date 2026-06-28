export function nested(input: string) {
  return useLegacy(useLegacy(input));
}

