export function assertWindowsTestNode(version = process.versions.node, platform = process.platform) {
  const [major, minor] = version.split('.').map(Number);
  // nodejs/node#63620: Windows Node 24.0-24.15 can silently fast-fail in
  // libuv TCP connect. Do not mask this with retries or interpret it as Electron.
  if (platform === 'win32' && major === 24 && minor < 16) {
    throw new Error(`Windows Electron tests cannot use Node ${version}; use Node 24.16.0 or later (nodejs/node#63620).`);
  }
}
