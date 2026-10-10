import { test, expect, type Page } from '@playwright/test';
import { MINIMAL_ISC_YAML } from '../helpers/minimalConfig.js';

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

test.describe('Operation modes', () => {
  test.beforeEach(async ({ page }) => {
    await mockNoCredentials(page);
    await page.goto('/operations');
  });

  test('mirror to disk is the default and shows no registry fields', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Mirror to disk' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Mirror Destination Folder')).toBeVisible();
    await expect(page.getByLabel('Destination registry')).toHaveCount(0);
  });

  test('mirror to mirror shows the workspace label, destination, and TLS opt-out', async ({ page }) => {
    await page.getByRole('button', { name: 'Mirror to mirror' }).click();
    await expect(page.getByText('Workspace Folder')).toBeVisible();
    await expect(page.getByLabel('Destination registry')).toBeVisible();
    await expect(page.getByLabel('Skip TLS verification for destination')).not.toBeChecked();

    await page.getByRole('button', { name: /Advanced Options/i }).click();
    await expect(page.getByLabel('Enable max nested paths')).toBeVisible();
  });

  test('max nested paths is hidden for mirror to disk', async ({ page }) => {
    await page.getByRole('button', { name: /Advanced Options/i }).click();
    await expect(page.getByLabel('Enable max nested paths')).toHaveCount(0);
  });

  test('invalid destination shows the server rule and disables start', async ({ page }) => {
    await page.getByRole('button', { name: 'Mirror to mirror' }).click();
    await page.getByLabel('Destination registry').fill('docker://reg.example.com');
    await expect(page.getByText(/must not include a scheme/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Operation' })).toBeDisabled();
  });

  test('warns when the destination host has no credentials and links to Settings', async ({ page }) => {
    await page.getByRole('button', { name: 'Mirror to mirror' }).click();
    await page.getByLabel('Destination registry').fill('mirror.example.com:5000/ocp');
    const warning = page.getByText('No credentials for mirror.example.com:5000');
    await expect(warning).toBeVisible();
    await expect(page.getByRole('link', { name: /add credentials in Settings/i })).toHaveAttribute(
      'href',
      '/settings?tab=registry',
    );
  });

  test('disk to mirror uses the archive label and offers no folder creation', async ({ page }) => {
    await page.getByRole('button', { name: 'Disk to mirror' }).click();
    await expect(page.getByText('Archive Source Folder')).toBeVisible();
    await page.getByText('default', { exact: true }).click();
    await expect(page.getByText('Create new folder...')).toHaveCount(0);
  });
});

test.describe('Operation modes: credentials and requests', () => {
  // Credentials are often added in Settings in another tab; coming back must not
  // keep showing a warning for a host that now has credentials.
  test('refreshes the missing-credentials warning when the window regains focus', async ({ page }) => {
    let credentials: Array<{ registry: string; username: string; status: string }> = [];
    await page.route('**/api/registries', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registries: [] }) }));
    await page.route('**/api/registry-credentials', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ managedExternally: false, path: null, credentials }),
      }));
    await page.goto('/operations');
    await page.getByRole('button', { name: 'Mirror to mirror' }).click();
    await page.getByLabel('Destination registry').fill('mirror.example.com:5000/ocp');
    await expect(page.getByText('No credentials for mirror.example.com:5000')).toBeVisible();

    credentials = [{ registry: 'mirror.example.com:5000', username: 'u', status: 'not_verified' }];
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('No credentials for mirror.example.com:5000')).toHaveCount(0);
  });

  // A malformed credentials file makes the start fail; telling the user the push
  // will be anonymous would send them looking for the wrong problem.
  test('shows the credentials file error instead of the anonymous-push warning', async ({ page }) => {
    await page.route('**/api/registries', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ registries: [] }) }));
    await page.route('**/api/registry-credentials', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ managedExternally: false, path: null, credentials: [], error: 'Destination registry credentials at /x is not valid JSON' }),
      }));
    await page.goto('/operations');
    await page.getByRole('button', { name: 'Mirror to mirror' }).click();
    await page.getByLabel('Destination registry').fill('mirror.example.com:5000/ocp');
    await expect(page.getByText(/is not valid JSON/)).toBeVisible();
    await expect(page.getByText(/push anonymously/)).toHaveCount(0);
  });

  test('disk to mirror lists existing folders but offers no folder creation', async ({ page }) => {
    await mockNoCredentials(page);
    await page.route('**/api/mirror-folders', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: ['default', 'archives-e2e'] }) }));
    await page.goto('/operations');
    await page.getByRole('button', { name: 'Disk to mirror' }).click();
    await page.getByText('default', { exact: true }).click();
    await expect(page.getByRole('option', { name: 'archives-e2e' })).toBeVisible();
    await expect(page.getByText('Create new folder...')).toHaveCount(0);
  });

  test('a mirror-to-disk start sends no registry fields left over from another mode', async ({ page, request }) => {
    const configName = `e2e-modes-m2d-${Date.now()}.yaml`;
    const saveRes = await request.post('/api/config/save', { data: { config: MINIMAL_ISC_YAML, name: configName } });
    expect(saveRes.ok()).toBeTruthy();
    try {
      await mockNoCredentials(page);
      let startBody: Record<string, unknown> | undefined;
      await page.route('**/api/operations/start', async (route) => {
        startBody = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok', operationId: 'e2e-fake-op' }) });
      });
      await page.goto('/operations');

      const configToggle = page.getByLabel('Select ImageSetConfiguration file');
      await configToggle.click();
      await page.getByRole('option', { name: new RegExp(configName) }).click();

      await page.getByRole('button', { name: 'Mirror to mirror' }).click();
      await page.getByLabel('Destination registry').fill('mirror.example.com:5000/ocp');
      await page.getByLabel('Skip TLS verification for destination').check();
      await page.getByRole('button', { name: /Advanced Options/i }).click();
      await page.locator('#flag-max-nested-paths').click({ force: true });
      await expect(page.getByLabel('Enable max nested paths')).toBeChecked();

      await page.getByRole('button', { name: 'Mirror to disk' }).click();
      await page.getByRole('button', { name: 'Start Operation' }).click();

      await expect.poll(() => startBody).toBeDefined();
      expect(startBody!.mode).toBe('mirrorToDisk');
      expect(startBody).not.toHaveProperty('destinationRegistry');
      expect(startBody).not.toHaveProperty('skipDestTlsVerify');
      expect(startBody!.optionalFlags ?? {}).not.toHaveProperty('maxNestedPaths');
    } finally {
      await request.delete(`/api/config/delete/${configName}`).catch(() => {});
    }
  });
});
