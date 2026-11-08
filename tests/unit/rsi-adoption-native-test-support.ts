import { afterEach, expect } from 'vitest';

let nativeParserCalls = 0;
// SEKB attribution does not use the source-analysis parsers imported by the factory.
// Fail if this focused runtime path starts depending on a native parser.
export default class UnusedNativeParser {
  constructor() {
    nativeParserCalls++;
    throw new Error('Native source analysis was invoked in the RSI attribution gate');
  }
}
afterEach(() => expect(nativeParserCalls).toBe(0));
