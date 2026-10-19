import { test, expect, type Page } from '@playwright/test';
import { MINIMAL_ISC_YAML } from '../helpers/minimalConfig.js';

const DESTINATION = 'mirror.example.com:5000/ocp';

async function mockNoCredentials(page: Page) {
  await page.route('**/api/registries', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registries: [] }) }));
  await page.route('**/api/registry-credentials', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ managedExternally: false, path: null, credentials: [] }),
    }));
}

/** Captures the start request body and answers as if the operation started. */
async function captureStart(page: Page) {
  const captured: { body?: Record<string, unknown> } = {};
  await page.route('**/api/operations/start', async (route) => {
    captured.body = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok', operationId: 'e2e-fake-op' }) });
  });
  return captured;
}

async function selectConfig(page: Page, configName: string) {
  await page.getByLabel('Select ImageSetConfiguration file').click();
  await page.getByRole('option', { name: new RegExp(configName) }).click();
}

test.describe('Mirror to mirror and disk to mirror starts', () => {
  let configName: string;

  test.beforeEach(async ({ page, request }) => {
    configName = `e2e-m2m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.yaml`;
    const saveRes = await request.post('/api/config/save', { data: { config: MINIMAL_ISC_YAML, name: configName } });
    expect(saveRes.ok()).toBeTruthy();
    await mockNoCredentials(page);
  });

  test.afterEach(async ({ request }) => {
    await request.delete(`/api/config/delete/${configName}`).catch(() => {});
  });

  // The server builds the oc-mirror docker:// target from these fields, so any
  // that are dropped or left untrimmed send images to the wrong place or fail validation.
  test('a mirror-to-mirror start sends the trimmed destination, TLS choice, and max nested paths', async ({ page }) => {
    const start = await captureStart(page);
    await page.goto('/operations');
    await selectConfig(page, configName);

    await page.getByRole('button', { name: 'Mirror to mirror' }).click();
    await page.getByLabel('Destination registry').fill(`  ${DESTINATION}  `);
    await page.getByLabel('Skip TLS verification for destination').check();
    await page.getByRole('button', { name: /Advanced Options/i }).click();
    await page.locator('#flag-max-nested-paths').click({ force: true });
    await page.getByRole('button', { name: 'Increase max nested paths' }).click();
    await expect(page.getByRole('spinbutton', { name: 'Max nested paths' })).toHaveValue('3');

    await page.getByRole('button', { name: 'Start Operation' }).click();

    await expect.poll(() => start.body).toBeDefined();
    expect(start.body).toMatchObject({
      configFile: configName,
      mode: 'mirrorToMirror',
      destinationRegistry: DESTINATION,
      skipDestTlsVerify: true,
      optionalFlags: { maxNestedPaths: 3 },
    });
  });

  // Without a destination oc-mirror has nowhere to push, so the UI must not
  // let the user start and wait for a server-side rejection.
  test('start stays disabled until a valid destination is entered', async ({ page }) => {
    await page.goto('/operations');
    await selectConfig(page, configName);
    const startButton = page.getByRole('button', { name: 'Start Operation' });
    await expect(startButton).toBeEnabled();

    await page.getByRole('button', { name: 'Mirror to mirror' }).click();
    await expect(startButton).toBeDisabled();

    await page.getByLabel('Destination registry').fill(DESTINATION);
    await expect(startButton).toBeEnabled();
  });

  // Disk to mirror reads an existing archive folder; the selected folder is the
  // source, so it must reach the server along with the destination.
  test('a disk-to-mirror start sends the archive folder and destination', async ({ page }) => {
    await page.route('**/api/mirror-folders', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: ['default', 'archives-e2e'] }) }));
    const start = await captureStart(page);
    await page.goto('/operations');
    await selectConfig(page, configName);

    await page.getByRole('button', { name: 'Disk to mirror' }).click();
    await page.getByText('default', { exact: true }).click();
    await page.getByRole('option', { name: 'archives-e2e' }).click();
    await page.getByLabel('Destination registry').fill(DESTINATION);
    await page.getByRole('button', { name: 'Start Operation' }).click();

    await expect.poll(() => start.body).toBeDefined();
    expect(start.body).toMatchObject({
      configFile: configName,
      mode: 'diskToMirror',
      mirrorDestinationSubdir: 'archives-e2e',
      destinationRegistry: DESTINATION,
      skipDestTlsVerify: false,
    });
  });

  test('shows the server reason when a disk-to-mirror start is rejected', async ({ page }) => {
    await page.route('**/api/operations/start', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Archive source folder not found' }) }));
    await page.goto('/operations');
    await selectConfig(page, configName);

    await page.getByRole('button', { name: 'Disk to mirror' }).click();
    await page.getByLabel('Destination registry').fill(DESTINATION);
    await page.getByRole('button', { name: 'Start Operation' }).click();

    const alert = page.locator('.pf-v6-c-alert.pf-m-danger');
    await expect(alert).toContainText('Failed to start operation: Archive source folder not found');
  });
});

test.describe('Mirror to mirror operations in the operations table', () => {
  const ops = [
    {
      id: 'm2m-table-0001',
      name: 'Mirror Operation m2m-table',
      configFile: 'm2m.yaml',
      mode: 'mirrorToMirror',
      destinationRegistry: DESTINATION,
      mirrorDestination: '/app/data/mirrors/ws',
      status: 'success',
      startedAt: '2026-10-01T10:00:00Z',
      completedAt: '2026-10-01T10:05:00Z',
      duration: 300,
    },
    {
      id: 'm2d-table-0001',
      name: 'Mirror Operation m2d-table',
      configFile: 'm2d.yaml',
      mode: 'mirrorToDisk',
      mirrorDestination: '/app/data/mirrors/default',
      status: 'success',
      startedAt: '2026-10-01T09:00:00Z',
      completedAt: '2026-10-01T09:05:00Z',
      duration: 300,
    },
  ];

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockNoCredentials(page);
    await page.route('**/api/system/info', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hostDataDir: '' }) }));
    await page.route('**/api/operations', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ops) });
    });
    await page.goto('/operations');
    await expect(page.locator('#operation-history-card table')).toBeVisible({ timeout: 10000 });
  });

  test('shows the mode and destination for each operation', async ({ page }) => {
    const card = page.locator('#operation-history-card');
    await expect(card.getByRole('row', { name: /m2m\.yaml/ })).toContainText(`Mirror to mirror${DESTINATION}`);
    await expect(card.getByRole('row', { name: /m2d\.yaml/ })).toContainText('Mirror to disk');
  });

  // The cluster resources (IDMS, ITMS, CatalogSource) are what the user applies
  // to the cluster after pushing, so the copied path must match the server layout.
  test('copies the cluster resources path for a finished mirror-to-mirror operation', async ({ page }) => {
    await page.getByRole('button', { name: 'Actions for Mirror Operation m2m-table' }).click();
    await page.getByRole('menuitem', { name: 'Copy Cluster Resources Path' }).click();
    await expect(page.getByText('Full path copied to clipboard!')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/app/data/mirrors/ws/working-dir/cluster-resources');
  });

  test('offers no cluster resources path for a mirror-to-disk operation', async ({ page }) => {
    await page.getByRole('button', { name: 'Actions for Mirror Operation m2d-table' }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy Location' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Copy Cluster Resources Path' })).toHaveCount(0);
  });
});
