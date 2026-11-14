const fs = require('node:fs');
const { createRequire } = require('node:module');
const req = createRequire('C:/Users/27933/.codex/worktrees/project-rag-longterm-20261109/ClawX/node_modules/@playwright/test/cli.js');
const electron = req('@playwright/test')._electron;
const file = 'D:/tmp/project-rag-relay-01a1d9e2/main3-electron-recovery/main-events.jsonl';
const note = (event, extra = {}) => fs.appendFileSync(file, JSON.stringify({ event, pid: process.pid, time: new Date().toISOString(), ...extra }) + '\n');
note('preload');
const marker = Symbol.for('rag-main-exit-trace-v3');
if (!electron[marker]) {
  electron[marker] = true;
  const launch = electron.launch.bind(electron);
  electron.launch = async function (options) {
    note('launch-called');
    const application = await launch(options);
    note('launch-resolved', { mainPid: application.process().pid });
    await application.evaluate(({ app, BrowserWindow }) => {
      const fs = process.getBuiltinModule('fs');
      const file = 'D:/tmp/project-rag-relay-01a1d9e2/main3-electron-recovery/main-events.jsonl';
      const note = (event, extra = {}) => fs.appendFileSync(file, JSON.stringify({ event, pid: process.pid, time: new Date().toISOString(), ...extra }) + '\n');
      for (const method of ['quit', 'exit']) {
        const original = app[method];
        app[method] = function (...args) { note('app.' + method, { args, stack: new Error().stack }); return original.apply(this, args); };
      }
      const exit = process.exit;
      process.exit = function (...args) { note('process.exit', { args, stack: new Error().stack }); return exit.apply(this, args); };
      for (const event of ['window-all-closed', 'before-quit', 'will-quit', 'quit']) app.on(event, () => note(event, { windows: BrowserWindow.getAllWindows().length }));
      const observeWindow = window => {
        for (const event of ['close', 'closed']) window.on(event, () => note('window-' + event, { id: window.id }));
        window.webContents.on('render-process-gone', (_event, details) => note('render-process-gone', details));
      };
      for (const window of BrowserWindow.getAllWindows()) observeWindow(window);
      app.on('browser-window-created', (_event, window) => observeWindow(window));
      process.on('exit', code => note('process-exit-event', { code }));
      note('main-trace-installed');
    });
    return application;
  };
}
