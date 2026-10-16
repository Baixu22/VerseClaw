import { expect, it } from 'vitest';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { renderToolResultForTool } from '../src/mcp/result-envelope.ts';

it('reports form property changes without leaking secret values', async () => {
  const api = await createPlaywrightHostApi();
  const facade = new AgentBrowserFacade({ api });
  const html = '<input id="name" aria-label="Name"><input id="check" aria-label="Accept" type="checkbox"><select id="choice" aria-label="Choice"><option value="one">One</option><option value="two">Two</option></select><input type="password" id="secret" aria-label="Password">';
  const opened = await api.open({ mode: 'headless', url: 'data:text/html,' + encodeURIComponent(html) });
  const sessionId = opened.session.id;
  try {
    await facade.snapshot(sessionId);
    await api.evaluate({ sessionId, expression: `(() => {
      document.querySelector('#name').value='Ada'; document.querySelector('#name').readOnly=true;
      document.querySelector('#check').checked=true; document.querySelector('#choice').value='two';
      document.querySelector('#secret').value='secret-without-a-pattern';
    })()` });
    const changed = await facade.snapshot(sessionId, { diff: true });
    expect(changed.content).toContain('checked false -> true');
    expect(changed.content).toContain('value "" -> "Ada"');
    expect(changed.content).toContain('value "one" -> "two"');
    expect(changed.content).toContain('readOnly false -> true');
    expect(renderToolResultForTool('vb_snapshot', changed)).not.toContain('secret-without-a-pattern');
    const same = await facade.snapshot(sessionId, { diff: true });
    expect(same.content).toContain('no observable change');
    await api.evaluate({ sessionId, expression: 'document.querySelector("#name").value=""' });
    expect((await facade.snapshot(sessionId, { diff: true })).content).toContain('value "Ada" -> ""');
  } finally { await facade.close(sessionId); }
});
