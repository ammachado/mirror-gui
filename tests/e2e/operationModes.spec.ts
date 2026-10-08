import { test, expect, type Page } from '@playwright/test';

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
