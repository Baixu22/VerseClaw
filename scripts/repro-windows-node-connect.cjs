// Agent-driven, loopback-only regression for nodejs/node#63620 (fixed by #62561).
// Run the same file under the old and fixed executables; no app/user state needed.
const http = require('node:http');
const durationMs = Number(process.argv[2] || 60_000);
if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 120_000) throw Error('Invalid duration');
const concurrency = 96;
const server = http.createServer((_req, res) => res.end('ok'));
console.log(JSON.stringify({ phase: 'start', pid: process.pid, execPath: process.execPath, node: process.version, uv: process.versions.uv, time: new Date().toISOString() }));
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const agent = new http.Agent({ keepAlive: false, maxSockets: concurrency });
  const end = Date.now() + durationMs;
  let outstanding = 0, made = 0, errors = 0;
  function pump() {
    while (outstanding < concurrency && Date.now() < end) {
      made++; outstanding++;
      const req = http.get({ host: '127.0.0.1', port, agent }, res => {
        res.resume(); res.once('end', () => outstanding--);
      });
      req.once('error', () => { errors++; outstanding--; });
    }
    if (Date.now() < end || outstanding) { setImmediate(pump); return; }
    agent.destroy();
    server.close(() => console.log(JSON.stringify({ phase: 'complete', pid: process.pid, made, errors, time: new Date().toISOString() })));
  }
  pump();
});
