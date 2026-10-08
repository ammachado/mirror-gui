import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

describe('System API', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  describe('GET /api/system/paths', () => {
    it('returns array of path objects with available boolean', async () => {
      const res = await request.get('/api/system/paths');
      expect(res.status).toBe(200);
      expect(res.body.paths).toBeDefined();
      expect(Array.isArray(res.body.paths)).toBe(true);
      for (const p of res.body.paths) {
        expect(p).toHaveProperty('path');
        expect(p).toHaveProperty('label');
        expect(p).toHaveProperty('description');
        expect(typeof p.available).toBe('boolean');
      }
    });
  });

  describe('GET /api/system/info', () => {
    it('returns system info structure', async () => {
      const res = await request.get('/api/system/info');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ocMirrorVersion');
      expect(res.body).toHaveProperty('systemArchitecture');
      expect(typeof res.body.availableDiskSpace).toBe('number');
      expect(typeof res.body.totalDiskSpace).toBe('number');
    });

    it('reports artifactDownloadsEnabled from the override so the UI can show downloads', async () => {
      const original = process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS;
      try {
        process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS = 'true';
        const enabled = await request.get('/api/system/info');
        expect(enabled.status).toBe(200);
        expect(enabled.body.artifactDownloadsEnabled).toBe(true);

        process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS = 'false';
        const disabled = await request.get('/api/system/info');
        expect(disabled.body.artifactDownloadsEnabled).toBe(false);
      } finally {
        if (original === undefined) delete process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS;
        else process.env.MIRROR_GUI_ARTIFACT_DOWNLOADS = original;
      }
    });
  });

  describe('GET /api/system/status', () => {
    it('returns status with version fields', async () => {
      const res = await request.get('/api/system/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ocMirrorVersion');
      expect(res.body).toHaveProperty('systemHealth');
      expect(['healthy', 'degraded', 'warning', 'error']).toContain(res.body.systemHealth);
    });
  });
});
