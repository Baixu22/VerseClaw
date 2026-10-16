/** Windows TCP connections require libuv's OSVERSIONINFOW initialization fix. */
export function assertBrowserRuntime(
  runtime: { platform: string; versions: { node: string; uv: string } } = process,
): void {
  if (runtime.platform !== 'win32') return;
  const [major, minor, patch] = runtime.versions.uv.split('.').map(Number);
  if (major > 1 || (major === 1 && (minor > 52 || (minor === 52 && patch >= 1)))) return;
  throw Object.assign(new Error(
    `Windows browser operations require libuv >=1.52.1 (Node.js 24.16.0 or later). ` +
    `Node.js ${runtime.versions.node} uses libuv ${runtime.versions.uv}, which is outside this supported range; ` +
    `upgrade Node.js before opening or probing a browser to avoid native TCP stack-cookie crashes.`,
  ), { code: 'E_NODE_RUNTIME' });
}
