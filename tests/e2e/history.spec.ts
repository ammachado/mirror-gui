import { test, expect, Page, Route } from '@playwright/test';
import { MINIMAL_ISC_YAML } from '../helpers/minimalConfig.js';
import { seedOperation } from '../helpers/seedOperation.js';
import {
  assertRowCheckboxToggles,
  assertMultiRowSelect,
  assertSelectAllToggles,
  assertDeleteSelectedButtonVisibility,
  assertCancelModalKeepsRows,
  assertDeleteSelectedRemovesOnlyChecked,
  assertSelectAllDeleteRemovesAll,
} from '../helpers/selectionTestUtils.js';

test.describe('History', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/history');
  });

  test('history page loads', async ({ page }) => {
    await expect(page).toHaveURL(/\/history/);
    await expect(page.getByText('Operation History').first()).toBeVisible({ timeout: 15000 });
  });

  test('filter dropdown is present', async ({ page }) => {
    await expect(page.getByLabel('Filter operations')).toBeVisible({ timeout: 15000 });
  });

  test('export button is present', async ({ page }) => {
    await expect(page.getByText('Export CSV').first()).toBeVisible({ timeout: 15000 });
  });

  test('filter dropdown shows all status options', async ({ page }) => {
    const toggle = page.getByLabel('Filter operations');
    await expect(toggle).toBeVisible({ timeout: 15000 });
    await toggle.click();
    await expect(page.getByRole('option', { name: 'All Operations' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Successful' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Failed' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Stopped' })).toBeVisible();
  });

  test('select all checkbox is present when operations exist', async ({ page }) => {
    const table = page.locator('table');
    const emptyState = page.getByText('No operations found.');
    const hasTable = await table.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasTable) {
      await expect(table.locator('thead input[type="checkbox"]')).toBeVisible();
    } else {
      await expect(emptyState).toBeVisible();
    }
  });

  test('Delete All button is present when operations exist', async ({ page }) => {
    const table = page.locator('table');
    const hasTable = await table.isVisible({ timeout: 5000 }).catch(() => false);
    if (hasTable) {
      await expect(page.getByRole('button', { name: /delete all/i })).toBeVisible();
    }
  });
});

// Row checkbox selection and "Delete Selected" on the History page.
test.describe('History - Row Selection & Bulk Delete Selected', () => {
  test.describe.configure({ mode: 'serial' });

  const createdConfigs: string[] = [];
  const createdOperations: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const opId of createdOperations) {
      await request.post(`/api/operations/${opId}/stop`).catch(() => {});
      await request.delete(`/api/operations/${opId}`).catch(() => {});
    }
    for (const name of createdConfigs) {
      await request.delete(`/api/config/delete/${name}`).catch(() => {});
    }
  });

  test.beforeAll(async ({ request }) => {
    createdConfigs.length = 0;
    createdOperations.length = 0;

    for (let i = 1; i <= 3; i++) {
      const configName = `e2e-histsel-${Date.now()}-${i}.yaml`;
      createdConfigs.push(configName);

      const saveRes = await request.post('/api/config/save', {
        data: { config: MINIMAL_ISC_YAML, name: configName },
      });
      expect(saveRes.ok(), `Config save failed: ${await saveRes.text()}`).toBeTruthy();

      await seedOperation(request, configName, createdOperations);
    }
  });

  test('row checkbox toggles on click', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertRowCheckboxToggles(table, createdConfigs[0]);
  });

  test('checking multiple rows selects only those rows', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertMultiRowSelect(table, [createdConfigs[0], createdConfigs[2]], createdConfigs[1]);
  });

  test('select-all checkbox checks and unchecks every row', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertSelectAllToggles(table, createdConfigs);
  });

  test('"Delete Selected" button appears with correct count and hides after uncheck', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertDeleteSelectedButtonVisibility(table, page, [createdConfigs[0], createdConfigs[1]]);
  });

  test('cancelling the bulk-delete modal keeps all rows intact', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertCancelModalKeepsRows(page, table, page, createdConfigs, 'Confirm deletion');
  });

  test('confirming "Delete Selected" removes only the checked row', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertDeleteSelectedRemovesOnlyChecked(page, table, page, createdConfigs[0], createdConfigs.slice(1), 'Confirm deletion');
  });

  test('select-all then "Delete Selected" removes all remaining rows', async ({ page }) => {
    await page.goto('/history');
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await assertSelectAllDeleteRemovesAll(page, table, page, createdConfigs.slice(1), 'Confirm deletion', page);
  });
});

// Artifact downloads in the History details panel. All API calls are mocked so the
// tests do not depend on a real oc-mirror run or on running inside a cluster.
test.describe('History - Artifact downloads', () => {
  const now = Date.now();
  const successOp = {
    id: 'op-art-success',
    name: 'artifact-success-op',
    configFile: 'artifact-config.yaml',
    status: 'success',
    startedAt: new Date(now - 3600000).toISOString(),
    completedAt: new Date(now - 3000000).toISOString(),
    duration: 600,
  };
  const failedOp = {
    ...successOp,
    id: 'op-art-failed',
    name: 'artifact-failed-op',
    status: 'failed',
    errorMessage: 'boom',
  };
  const listing = {
    mirrorDestination: '/app/data/mirrors/default',
    artifacts: [
      { name: 'mirror_000001.tar', size: 5368709120, modifiedAt: new Date(now - 3000000).toISOString() },
    ],
  };

  async function mockApis(
    page: Page,
    options: { enabled: boolean; artifacts?: (route: Route) => Promise<void> },
  ) {
    const json = (route: Route, body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    await page.route('**/api/operations/history', route => json(route, [successOp, failedOp]));
    await page.route('**/api/system/info', route => json(route, { artifactDownloadsEnabled: options.enabled }));
    await page.route('**/api/operations/*/details', route => json(route, {}));
    await page.route('**/api/operations/*/logs', route => json(route, { logs: '' }));
    await page.route('**/api/operations/*/artifacts', options.artifacts ?? (route => json(route, listing)));
  }

  async function openDetails(page: Page, opName: string) {
    await page.goto('/history');
    await page.getByText(opName).click();
    await expect(page.getByRole('heading', { name: /Log Output/ })).toBeVisible({ timeout: 15000 });
  }

  test('lists artifacts with browser download links for a successful operation', async ({ page }) => {
    await mockApis(page, { enabled: true });
    await openDetails(page, successOp.name);

    await expect(page.getByRole('heading', { name: 'Artifacts' })).toBeVisible();
    await expect(page.getByText('/app/data/mirrors/default')).toBeVisible();
    await expect(page.getByText(/may also contain archives from other operations/)).toBeVisible();

    const link = page.getByRole('link', { name: 'Download mirror_000001.tar' });
    await expect(link).toHaveAttribute('href', '/api/operations/op-art-success/artifacts/mirror_000001.tar');
    await expect(link).toHaveAttribute('download', 'mirror_000001.tar');
    await expect(page.getByRole('grid', { name: 'Operation artifacts' }).getByText('5.00 GB')).toBeVisible();
  });

  test('hides the section when downloads are not enabled (local podman run)', async ({ page }) => {
    await mockApis(page, { enabled: false });
    await openDetails(page, successOp.name);
    await expect(page.getByRole('heading', { name: 'Artifacts' })).toHaveCount(0);
  });

  test('hides the section for a failed operation even when enabled', async ({ page }) => {
    await mockApis(page, { enabled: true });
    await openDetails(page, failedOp.name);
    await expect(page.getByRole('heading', { name: 'Artifacts' })).toHaveCount(0);
  });

  test('shows an empty state when the destination has no files', async ({ page }) => {
    await mockApis(page, {
      enabled: true,
      artifacts: route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mirrorDestination: listing.mirrorDestination, artifacts: [] }),
      }),
    });
    await openDetails(page, successOp.name);
    await expect(page.getByText('No artifacts found in the mirror destination.')).toBeVisible();
  });

  test('shows an inline error when the list cannot be loaded', async ({ page }) => {
    await mockApis(page, {
      enabled: true,
      artifacts: route => route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Failed to list artifacts' }),
      }),
    });
    await openDetails(page, successOp.name);
    await expect(page.getByText('Could not load artifacts')).toBeVisible();
    await expect(page.getByText('Failed to list artifacts')).toBeVisible();
  });
});
