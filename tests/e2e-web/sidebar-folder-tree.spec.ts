/**
 * F2 + F3 + workstream redesign — the sidebar grouping surface against the
 * mutable mock fixture (docs/dev/session-workstreams-design.md).
 *
 * Fixture: legacy nested folders 渲染修复 → 审计回归 → 深层用例 (flattened with
 * path prefixes) + flat 发布准备 carrying a fork lineage (发布说明草稿 ⑂←
 * Mock 场景目录); unfiled sessions slice into 今天 / 本周, with 闲置草稿
 * attached under 主会话 by lineage.
 */
import { expect, test, type Page } from '@playwright/test';
import { openScenario } from './helpers';

const ROOT = 'sidebar-folder-folder-root-a';
const CHILD = 'sidebar-folder-folder-child-a1';
const GRANDCHILD = 'sidebar-folder-folder-grandchild-a2';
const STREAM_B = 'sidebar-folder-folder-root-b';
const DEEP_SESSION = 'agent:main:deep-case';

async function openSidebarTree(page: Page) {
  await openScenario(page);
  await expect(page.getByTestId(ROOT)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(GRANDCHILD)).toBeVisible();
}

/** Hover the stream's own header row so its hover-only actions materialize. */
function streamHeaderRow(page: Page, folderTestId: string) {
  return page.getByTestId(folderTestId).locator('.sidebar-row').first();
}

test('legacy nested folders flatten to streams with ancestry prefixes', async ({ page }) => {
  await openSidebarTree(page);

  // No nesting in the DOM: the grandchild is NOT inside its former parent.
  await expect(page.getByTestId(ROOT).getByTestId(GRANDCHILD)).toHaveCount(0);
  // Its ancestry survives: nearest ancestor inline, full chain in the tooltip.
  const path = page.getByTestId('sidebar-stream-path-folder-grandchild-a2');
  await expect(path).toContainText('审计回归');
  await expect(path).toHaveAttribute('title', /渲染修复 ⧸ 审计回归 ⧸ 深层用例/);
  // Every stream carries its accent dot.
  await expect(page.getByTestId('sidebar-stream-dot-folder-root-a')).toBeVisible();
});

test('renaming a legacy-nested stream leaves its former ancestors untouched (F2)', async ({ page }) => {
  await openSidebarTree(page);

  const grandchild = page.getByTestId(GRANDCHILD);
  await streamHeaderRow(page, GRANDCHILD).hover();
  await grandchild.getByLabel('重命名工作线').first().click();
  const editor = grandchild.locator('input');
  await expect(editor).toBeVisible();
  await editor.fill('深层用例（改名后）');
  await editor.press('Enter');

  await expect(page.getByTestId('sidebar-folder-toggle-folder-grandchild-a2')).toContainText('深层用例（改名后）');
  // The regression this locks: the rename used to land on the parent chain.
  await expect(page.getByTestId('sidebar-folder-toggle-folder-child-a1')).toContainText('审计回归');
  await expect(page.getByTestId('sidebar-folder-toggle-folder-root-a')).toContainText('渲染修复');
});

test('deleting a legacy-nested stream keeps its former ancestors alive (F2)', async ({ page }) => {
  await openSidebarTree(page);

  await streamHeaderRow(page, GRANDCHILD).hover();
  await page.getByTestId('sidebar-folder-delete-folder-grandchild-a2').click();

  await expect(page.getByTestId(GRANDCHILD)).toHaveCount(0);
  await expect(page.getByTestId(CHILD)).toBeVisible();
  await expect(page.getByTestId(ROOT)).toBeVisible();
  await expect(page.getByTestId(STREAM_B)).toBeVisible();
});

test('a session filed in a stream can be moved out (F3)', async ({ page }) => {
  await openSidebarTree(page);

  const grandchild = page.getByTestId(GRANDCHILD);
  const sessionRow = grandchild.getByTestId(`sidebar-session-${DEEP_SESSION}`);
  await expect(sessionRow).toBeVisible();

  await sessionRow.hover();
  await page.getByTestId(`sidebar-session-move-${DEEP_SESSION}`).click();
  // The move menu is a portal, so the sidebar scroller cannot clip it.
  await expect(page.getByTestId(`sidebar-session-move-menu-${DEEP_SESSION}`)).toBeVisible();
  await page.getByTestId('sidebar-session-move-none').click();

  // Out of the stream, still alive in the unfiled area.
  await expect(grandchild.getByTestId(`sidebar-session-${DEEP_SESSION}`)).toHaveCount(0);
  await expect(page.getByTestId(`sidebar-session-${DEEP_SESSION}`)).toBeVisible();
});

test('fork lineage attaches sessions beneath their origin, in streams and unfiled alike', async ({ page }) => {
  await openSidebarTree(page);

  // In-stream: 发布说明草稿 was forked from Mock 场景目录 — same stream, so it
  // attaches beneath it with the lineage connector and origin tooltip.
  const streamLineage = page.getByTestId('sidebar-lineage-agent:main:release-notes');
  await expect(streamLineage).toBeVisible();
  await expect(streamLineage).toHaveAttribute('title', /Mock 场景目录/);
  await expect(page.getByTestId(STREAM_B).getByTestId('sidebar-session-agent:main:release-notes')).toBeVisible();

  // Unfiled: 闲置草稿 forked from 主会话 rides with its origin instead of
  // sinking alone into "earlier".
  const unfiledLineage = page.getByTestId('sidebar-lineage-agent:main:idle-scratch');
  await expect(unfiledLineage).toBeVisible();
  await expect(unfiledLineage).toHaveAttribute('title', /主会话/);
});

test('unfiled sessions slice into time sections', async ({ page }) => {
  await openSidebarTree(page);

  await expect(page.getByTestId('sidebar-time-slice-today')).toBeVisible();
  await expect(page.getByTestId('sidebar-time-slice-week')).toBeVisible();
  // 发布回溯 (3 days old, no lineage) sits in the week slice.
  await expect(page.getByTestId('sidebar-session-agent:main:probe-archive')).toBeVisible();
});

test('the move menu creates a new stream and files the session in one step', async ({ page }) => {
  await openSidebarTree(page);

  const sessionRow = page.getByTestId('sidebar-session-agent:main:probe-archive');
  await sessionRow.hover();
  await page.getByTestId('sidebar-session-move-agent:main:probe-archive').click();
  await page.getByTestId('sidebar-stream-new-inline').click();
  await page.getByTestId('sidebar-stream-new-input').fill('回溯验证线');
  await page.getByTestId('sidebar-stream-new-input').press('Enter');

  // The new stream exists, carries the session, and the menu is gone.
  const newStream = page.getByTestId(/^sidebar-folder-folder-created-/);
  await expect(newStream).toBeVisible();
  await expect(newStream).toContainText('回溯验证线');
  await expect(newStream.getByTestId('sidebar-session-agent:main:probe-archive')).toBeVisible();
  await expect(page.getByTestId('sidebar-session-move-menu-agent:main:probe-archive')).toHaveCount(0);
});
