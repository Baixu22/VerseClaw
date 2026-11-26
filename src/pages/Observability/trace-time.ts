const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function formatTraceTime(timestamp?: number): string {
  return timestamp != null && Number.isFinite(new Date(timestamp).getTime()) ? clock.format(timestamp) : '–';
}
