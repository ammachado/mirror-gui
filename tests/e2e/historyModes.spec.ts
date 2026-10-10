import { test, expect } from '@playwright/test';

const ops = [
  {
    id: 'm2m-op-0001',
    name: 'Mirror Operation m2m-op-0',
    configFile: 'isc.yaml',
    mode: 'mirrorToMirror',
    destinationRegistry: 'reg.example.com:5000/ocp',
    mirrorDestination: '/app/data/mirrors/ws',
    status: 'success',
    startedAt: '2026-10-01T10:00:00Z',
    completedAt: '2026-10-01T10:05:00Z',
    duration: 300,
  },
  {
    id: 'legacy-op-0001',
    name: 'Mirror Operation legacy-o',
    configFile: 'isc.yaml',
    status: 'success',
    startedAt: '2026-09-01T10:00:00Z',
    completedAt: '2026-09-01T10:05:00Z',
    duration: 300,
  },
];

test.describe('History modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/operations/history', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ops) }));
    await page.route('**/api/operations/m2m-op-0001/details', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'mirrorToMirror',
          destinationRegistry: 'reg.example.com:5000/ocp',
          clusterResourcesPath: '/app/data/mirrors/ws/working-dir/cluster-resources',
          configFile: 'isc.yaml',
        }),
      }));
    await page.goto('/history');
  });

  test('shows the mode for each operation, treating legacy records as mirror to disk', async ({ page }) => {
    await expect(page.getByRole('row', { name: /m2m-op-0/ })).toContainText('Mirror to mirror');
    await expect(page.getByRole('row', { name: /legacy-o/ })).toContainText('Mirror to disk');
  });

  test('details show the destination and cluster resources path', async ({ page }) => {
    await page.getByText('Mirror Operation m2m-op-0').click();
    await expect(page.getByText('reg.example.com:5000/ocp').first()).toBeVisible();
    await expect(page.getByText('/app/data/mirrors/ws/working-dir/cluster-resources')).toBeVisible();
  });

  test('CSV export includes mode and destination columns', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export CSV/i }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf8');
    const [header, ...rows] = csv.split('\n');
    expect(header).toBe('"Operation Name","Status","Started","Duration","Config File","Error Message","Mode","Destination Registry"');
    expect(rows.find((r) => r.includes('m2m-op-0'))).toMatch(/"Mirror to mirror","reg\.example\.com:5000\/ocp"$/);
    expect(rows.find((r) => r.includes('legacy-o'))).toMatch(/"Mirror to disk",""$/);
  });
});
