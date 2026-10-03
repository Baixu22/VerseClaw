/* Test typing surface for the historical UAS-00 manifest. */
export const buildUas00AuditManifest: any;
export const compareUas00AuditManifest: any;
export function assertUas00HistoryRoot(root: string, options: { historyReplay?: boolean }): string;
export function parseUas00ReplayArgs(argv: string[]): {
  historyReplay: true;
  root: string;
  output: string;
  check: boolean;
};
export function replayUas00History(options: {
  historyReplay: boolean;
  root: string;
  output: string;
  check?: boolean;
}): ReturnType<typeof buildUas00AuditManifest>;
