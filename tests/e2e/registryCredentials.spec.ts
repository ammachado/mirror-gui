import { test, expect } from '@playwright/test';

test.describe('Destination registry credentials', () => {
  test.afterEach(async ({ request }) => {
    await request.delete('/api/registry-credentials/e2e-mirror.example.com:5000').catch(() => {});
  });

  test('adds, lists without the password, and deletes a credential', async ({ page }) => {
    await page.goto('/settings?tab=registry');
    await expect(page.getByRole('heading', { name: 'Destination Registry Credentials' })).toBeVisible();

    await page.getByLabel('Destination registry host').fill('e2e-mirror.example.com:5000');
    await page.getByLabel('Destination registry username').fill('e2e-user');
    await page.getByLabel('Destination registry password').fill('e2e-S3cret');
    await page.getByRole('button', { name: 'Save credentials' }).click();

    const table = page.getByRole('grid', { name: 'Destination registry credentials' });
    const row = table.getByRole('row', { name: /e2e-mirror\.example\.com:5000/ });
    await expect(row).toContainText('e2e-user');
    await expect(page.getByText('e2e-S3cret')).toHaveCount(0);
    await expect(page.getByLabel('Destination registry password')).toHaveValue('');

    await row.getByRole('button', { name: 'Delete credentials for e2e-mirror.example.com:5000' }).click();
    await expect(table.getByRole('row', { name: /e2e-mirror\.example\.com:5000/ })).toHaveCount(0);
  });

  test('shows a read-only notice when credentials are managed externally', async ({ page }) => {
    await page.route('**/api/registry-credentials', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          managedExternally: true,
          path: '/app/registry-credentials/auth.json',
          credentials: [{ registry: 'ext.example.com', username: 'ext', status: 'not_verified' }],
        }),
      }));
    await page.goto('/settings?tab=registry');
    await expect(page.getByText(/managed outside the application at \/app\/registry-credentials\/auth\.json/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save credentials' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete credentials for ext.example.com' })).toHaveCount(0);
  });

  test('shows a load error instead of an empty table', async ({ page }) => {
    await page.route('**/api/registry-credentials', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ managedExternally: false, path: null, credentials: [], error: 'Destination registry credentials at /x is not valid JSON' }),
      }));
    await page.goto('/settings?tab=registry');
    await expect(page.getByText(/is not valid JSON/)).toBeVisible();
  });
});
