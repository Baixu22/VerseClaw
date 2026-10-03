export type IrcEvent = {
  t: string;
  driven_by: 'agent';
  actor: string;
  event: string;
  [key: string]: unknown;
};
export function startIrcServer(options?: {
  port?: number;
  host?: string;
  logPath?: string | null;
  onEvent?: (event: IrcEvent) => void;
}): Promise<{ port: number; events: IrcEvent[]; close: () => Promise<void> }>;
