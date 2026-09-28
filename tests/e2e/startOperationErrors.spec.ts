import { test, expect, Route } from '@playwright/test';
import { MINIMAL_ISC_YAML } from '../helpers/minimalConfig.js';

// E2E tests for start-operation error handling.
// Covers API-level validation (missing config, invalid subdir, bad flags)
// and UI-level feedback (danger alerts, button states).

test.describe('Start Operation - API Error Handling', () => {
  const createdConfigs: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const name of createdConfigs) {
      await request.delete(`/api/config/delete/${name}`).catch(() => {});
    }
  });

  test('returns 404 when config file does not exist', async ({ request }) => {
    const res = await request.post('/api/operations/start', {
      data: { configFile: 'nonexistent-config-file.yaml' },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Configuration file not found');
  });

  test('returns 400 when subdirectory contains path separators', async ({ request }) => {
    const configName = `e2e-start-err-sep-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    const saveRes = await request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

    const res = await request.post('/api/operations/start', {
      data: { configFile: configName, mirrorDestinationSubdir: '../escape' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('path separators or traversal');
  });

  test('returns 400 when subdirectory contains invalid characters', async ({ request }) => {
    const configName = `e2e-start-err-char-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    const saveRes = await request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

    const res = await request.post('/api/operations/start', {
      data: { configFile: configName, mirrorDestinationSubdir: 'bad dir!' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('invalid characters');
  });

  test('returns 400 for unknown optional flag key', async ({ request }) => {
    const configName = `e2e-start-err-flag-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    const saveRes = await request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

    const res = await request.post('/api/operations/start', {
      data: { configFile: configName, optionalFlags: { unknownFlag: true } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Unknown optional flag');
  });

  test('returns 400 when optionalFlags is not an object', async ({ request }) => {
    const configName = `e2e-start-err-flagtype-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    const saveRes = await request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

    const res = await request.post('/api/operations/start', {
      data: { configFile: configName, optionalFlags: 'not-an-object' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('optionalFlags must be an object');
  });

  test('returns 400 when imageTimeout has invalid format', async ({ request }) => {
    const configName = `e2e-start-err-timeout-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    const saveRes = await request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

    const res = await request.post('/api/operations/start', {
      data: { configFile: configName, optionalFlags: { imageTimeout: 'bad' } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('imageTimeout');
  });

  test('returns 400 when retryTimes is negative', async ({ request }) => {
    const configName = `e2e-start-err-retry-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    const saveRes = await request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

    const res = await request.post('/api/operations/start', {
      data: { configFile: configName, optionalFlags: { retryTimes: -1 } },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('retryTimes');
  });
});

test.describe('Start Operation - UI Error Feedback', () => {
  const createdConfigs: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const name of createdConfigs) {
      await request.delete(`/api/config/delete/${name}`).catch(() => {});
    }
  });

  test('shows danger alert when API returns an error on start', async ({ page }) => {
    const configName = `e2e-start-ui-err-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    const saveRes = await page.request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok()).toBeTruthy();

    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Start New Operation' })).toBeVisible({ timeout: 15000 });

    const configToggle = page.getByLabel('Select ImageSetConfiguration file');
    await configToggle.click();
    await page.getByRole('option', { name: new RegExp(configName) }).click();
    await expect(configToggle).toContainText(configName);

    // Delete the config behind the scenes so the server returns 404 on start.
    await page.request.delete(`/api/config/delete/${configName}`);

    await page.getByRole('button', { name: 'Start Operation' }).click();

    const alert = page.locator('.pf-v6-c-alert.pf-m-danger');
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText('Failed to start operation');
  });

  test('shows danger alert with server error detail for bad subdirectory', async ({ page }) => {
    const configName = `e2e-start-ui-subdir-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    await page.route('**/api/operations/start', (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Subdirectory name cannot contain path separators or traversal characters',
        }),
      });
    });

    const saveRes = await page.request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok()).toBeTruthy();

    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Start New Operation' })).toBeVisible({ timeout: 15000 });

    const configToggle = page.getByLabel('Select ImageSetConfiguration file');
    await configToggle.click();
    await page.getByRole('option', { name: new RegExp(configName) }).click();

    await page.getByRole('button', { name: 'Start Operation' }).click();

    const alert = page.locator('.pf-v6-c-alert.pf-m-danger');
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText('path separators or traversal');
  });

  test('start button re-enables after a failed start attempt', async ({ page }) => {
    const configName = `e2e-start-ui-reenable-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    await page.route('**/api/operations/start', (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated server error' }),
      });
    });

    const saveRes = await page.request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok()).toBeTruthy();

    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Start New Operation' })).toBeVisible({ timeout: 15000 });

    const configToggle = page.getByLabel('Select ImageSetConfiguration file');
    await configToggle.click();
    await page.getByRole('option', { name: new RegExp(configName) }).click();

    const startButton = page.getByRole('button', { name: 'Start Operation', exact: true });
    await startButton.click();

    await expect(startButton).toBeEnabled({ timeout: 10000 });
  });

  test('shows danger alert when network request fails entirely', async ({ page }) => {
    const configName = `e2e-start-ui-network-${Date.now()}.yaml`;
    createdConfigs.push(configName);

    await page.route('**/api/operations/start', (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.abort('connectionrefused');
    });

    const saveRes = await page.request.post('/api/config/save', {
      data: { config: MINIMAL_ISC_YAML, name: configName },
    });
    expect(saveRes.ok()).toBeTruthy();

    await page.goto('/operations');
    await expect(page.getByRole('heading', { name: 'Start New Operation' })).toBeVisible({ timeout: 15000 });

    const configToggle = page.getByLabel('Select ImageSetConfiguration file');
    await configToggle.click();
    await page.getByRole('option', { name: new RegExp(configName) }).click();

    await page.getByRole('button', { name: 'Start Operation' }).click();

    const alert = page.locator('.pf-v6-c-alert.pf-m-danger');
    await expect(alert).toBeVisible({ timeout: 10000 });
    await expect(alert).toContainText('Failed to start operation');
  });
});
