import { test, expect } from '@playwright/test';
import { MINIMAL_ISC_YAML } from '../helpers/minimalConfig.js';
import { seedOperation } from '../helpers/seedOperation.js';

// The operation log mirrors the console's pod log controls, so users get the same tools in
// both hosts: no wrapping by default, a line count, search, raw view, download and options.
test.describe('Operation log viewer', () => {
  const configName = `e2e-oplog-${Date.now()}.yaml`;
  const createdOperations: string[] = [];
  let operationId = '';
  let logText = '';

  test.beforeAll(async ({ request }) => {
    const saveRes = await request.post('/api/config/save', { data: { config: MINIMAL_ISC_YAML, name: configName } });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();
    operationId = await seedOperation(request, configName, createdOperations);
    logText = (await (await request.get(`/api/operations/${operationId}/logs`)).json()).logs;
    expect(logText.length, 'seeded operation should have log output').toBeGreaterThan(0);
  });

  test.afterAll(async ({ request }) => {
    for (const id of createdOperations) {
      await request.delete(`/api/operations/${id}`).catch(() => {});
    }
    await request.delete(`/api/config/delete/${configName}`).catch(() => {});
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/history');
    await page.getByRole('row', { name: new RegExp(configName) }).click();
    await expect(page.locator('.pf-v6-c-log-viewer')).toBeVisible({ timeout: 15000 });
  });

  test('a finished operation shows its line count, the stream as ended, and no pause control', async ({ page }) => {
    const lineCount = logText.replace(/\n$/, '').split('\n').length;
    await expect(page.getByText(`${lineCount} line${lineCount === 1 ? '' : 's'} - Log stream ended.`)).toBeVisible();
    await expect(page.getByRole('button', { name: /pause log stream|resume log stream/i })).toHaveCount(0);
  });

  test('long lines scroll horizontally until "Wrap lines" is turned on', async ({ page }) => {
    const viewer = page.locator('.pf-v6-c-log-viewer');
    await expect(viewer).toHaveClass(/pf-m-nowrap/);

    await page.getByRole('button', { name: 'Options' }).click();
    const wrapLines = page.getByRole('checkbox', { name: 'Wrap lines' });
    await expect(wrapLines).not.toBeChecked();
    await wrapLines.click();
    await expect(wrapLines).toBeChecked();
    await expect(viewer).not.toHaveClass(/pf-m-nowrap/);
  });

  test('Download saves the whole log as <operation id>.log', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${operationId}.log`);
    const saved = await download.path().then(p => import('fs').then(fs => fs.readFileSync(p, 'utf8')));
    expect(saved).toBe(logText);
  });

  test('View raw logs opens the whole log as plain text in a new tab', async ({ page, context }) => {
    const [rawPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'View raw logs' }).click(),
    ]);
    await rawPage.waitForLoadState();
    expect(rawPage.url()).toMatch(/^blob:/);
    expect((await rawPage.locator('body').innerText()).trimEnd()).toBe(logText.trimEnd());
  });

  test('search highlights matches in the log', async ({ page }) => {
    // Every oc-mirror log starts with the command line the server ran.
    expect(logText).toContain('oc-mirror');
    await page.getByPlaceholder('Search logs').fill('oc-mirror');
    await expect(page.locator('.pf-v6-c-log-viewer__string.pf-m-current')).toHaveText('oc-mirror');
  });
});
