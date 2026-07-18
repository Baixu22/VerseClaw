const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const root = process.cwd();
const p = path.join(root, 'artifacts/system-maturity/P8-ACCEPTANCE');
fs.mkdirSync(p, { recursive: true });
const outPath = path.join(p, 'trace2.out.txt');
const errPath = path.join(p, 'trace2.err.txt');
const exitPath = path.join(p, 'trace2.exit.txt');
const out = fs.openSync(outPath, 'w');
const err = fs.openSync(errPath, 'w');
const child = spawn(process.execPath, ['scripts/validate-system-maturity-traceability.mjs'], {
  cwd: root,
  detached: true,
  stdio: ['ignore', out, err],
  env: process.env,
});
fs.writeFileSync(path.join(p, 'trace2.pid.txt'), String(child.pid));
child.on('exit', (code) => {
  fs.writeFileSync(exitPath, String(code ?? 1));
});
child.unref();
console.log('LAUNCHED pid=' + child.pid);
