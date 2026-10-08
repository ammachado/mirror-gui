import { describe, it, expect, beforeAll } from 'vitest';
import { getTestApp } from './helpers/testApp.js';

// Without CORS headers a browser blocks other sites from reading API responses and from
// sending non-simple requests (JSON PUT/DELETE need a preflight the server no longer grants).
describe('Same-origin API access', () => {
  let request: Awaited<ReturnType<typeof getTestApp>>;

  beforeAll(async () => {
    request = await getTestApp();
  });

  it('does not grant a cross-origin preflight for credential writes', async () => {
    const res = await request
      .options('/api/registry-credentials')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'PUT')
      .set('Access-Control-Request-Headers', 'content-type');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('does not let another origin read the pull secret', async () => {
    const res = await request.get('/api/pull-secret/content').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  // A cross-site page can still send "simple" requests (text/plain or form bodies) without a
  // preflight. The server only parses application/json, so such a request must not start anything.
  it('ignores a cross-site simple POST that tries to start a mirror-to-mirror push', async () => {
    const before = (await request.get('/api/operations')).body.length;
    const res = await request
      .post('/api/operations/start')
      .set('Origin', 'https://evil.example')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ configFile: 'any.yaml', mode: 'mirrorToMirror', destinationRegistry: 'evil.example/loot' }));
    expect(res.status).not.toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request.get('/api/operations')).body.length).toBe(before);
  });

  it('still serves same-origin requests normally', async () => {
    const res = await request.get('/api/health');
    expect(res.status).toBe(200);
  });
});
