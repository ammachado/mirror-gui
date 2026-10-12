import { describe, it, expect } from 'vitest';
import {
  authenticateRegistry,
  createRegistryClient,
  parseAuthChallenge,
  type RegistryFetch,
  type RegistryResponse,
} from '../../server/registryAuth.js';

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function reply({ status, body = {}, headers = {} }: Reply): RegistryResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    header: (name) => headers[name.toLowerCase()] ?? null,
    text: async () => text,
  };
}

function fakeFetch(handler: (url: string, headers: Record<string, string>) => Reply) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fn: RegistryFetch = async (url, init) => {
    const headers = init?.headers ?? {};
    requests.push({ url, headers });
    return reply(handler(url, headers));
  };
  return Object.assign(fn, { requests });
}

describe('parseAuthChallenge', () => {
  it('extracts realm, service and scope', () => {
    const challenge = parseAuthChallenge(
      'Bearer realm="https://auth.example.com/token",service="registry",scope="repository:a/b:pull"',
    );
    expect(challenge).toEqual({
      realm: 'https://auth.example.com/token',
      service: 'registry',
      scope: 'repository:a/b:pull',
    });
  });

  it('returns null when there is no realm', () => {
    expect(parseAuthChallenge(null)).toBeNull();
    expect(parseAuthChallenge('Bearer service="registry"')).toBeNull();
  });
});

describe('authenticateRegistry', () => {
  it('succeeds with Basic credentials when /v2/ answers 200', async () => {
    const fetchFn = fakeFetch(() => ({ status: 200 }));
    const result = await authenticateRegistry('reg.example.com', 'dXNlcjpwdw==', fetchFn);
    expect(result).toEqual({ ok: true, authorization: 'Basic dXNlcjpwdw==' });
    expect(fetchFn.requests[0].url).toBe('https://reg.example.com/v2/');
    expect(fetchFn.requests[0].headers.Authorization).toBe('Basic dXNlcjpwdw==');
  });

  it('follows a bearer challenge and returns the token', async () => {
    const fetchFn = fakeFetch((url) =>
      url.startsWith('https://auth.example.com/token')
        ? { status: 200, body: { token: 'tok-1' } }
        : {
            status: 401,
            headers: { 'www-authenticate': 'Bearer realm="https://auth.example.com/token",service="registry"' },
          },
    );
    const result = await authenticateRegistry('reg.example.com', 'dXNlcjpwdw==', fetchFn);
    expect(result).toEqual({ ok: true, authorization: 'Bearer tok-1' });
    const tokenRequest = fetchFn.requests[1];
    expect(tokenRequest.url).toBe('https://auth.example.com/token?service=registry');
    expect(tokenRequest.headers.Authorization).toBe('Basic dXNlcjpwdw==');
  });

  it('reports the token endpoint status and body when it refuses', async () => {
    const fetchFn = fakeFetch((url) =>
      url.startsWith('https://auth.example.com/token')
        ? { status: 401, body: 'denied' }
        : { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://auth.example.com/token"' } },
    );
    const result = await authenticateRegistry('reg.example.com', 'x', fetchFn);
    expect(result).toEqual({ ok: false, error: 'Authentication failed (401): denied' });
  });

  it('reports the HTTP status when there is no challenge', async () => {
    const fetchFn = fakeFetch(() => ({ status: 401 }));
    const result = await authenticateRegistry('reg.example.com', 'x', fetchFn);
    expect(result).toEqual({ ok: false, error: 'HTTP 401' });
  });
});

describe('createRegistryClient', () => {
  it('requests a fresh scoped token for each repository that answers 401', async () => {
    const fetchFn = fakeFetch((url, headers) => {
      if (url.startsWith('https://auth.example.com/token')) {
        const scope = new URL(url).searchParams.get('scope');
        return { status: 200, body: { token: `token-for-${scope}` } };
      }
      const repo = url.match(/\/v2\/(.+)\/tags\/list/)?.[1] ?? '';
      if (headers.Authorization === `Bearer token-for-repository:${repo}:pull`) {
        return { status: 200, body: { tags: ['v1'] } };
      }
      return {
        status: 401,
        headers: {
          'www-authenticate': `Bearer realm="https://auth.example.com/token",service="registry",scope="repository:${repo}:pull"`,
        },
      };
    });
    const get = createRegistryClient('reg.example.com', 'dXNlcjpwdw==', fetchFn);

    const a = await get('/v2/ns/a/tags/list');
    const b = await get('/v2/ns/b/tags/list');

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const scopes = fetchFn.requests
      .filter((r) => r.url.startsWith('https://auth.example.com/token'))
      .map((r) => new URL(r.url).searchParams.get('scope'));
    expect(scopes).toEqual(['repository:ns/a:pull', 'repository:ns/b:pull']);
  });

  it('returns the original 401 for a Basic-only challenge instead of throwing', async () => {
    const fetchFn = fakeFetch(() => ({
      status: 401,
      headers: { 'www-authenticate': 'Basic realm="Registry"' },
    }));
    const get = createRegistryClient('reg.example.com', 'x', fetchFn);
    const res = await get('/v2/ns/a/tags/list');
    expect(res.status).toBe(401);
    expect(fetchFn.requests).toHaveLength(1);
  });

  it('sends no Authorization header when no credentials exist', async () => {
    const fetchFn = fakeFetch(() => ({ status: 200 }));
    const get = createRegistryClient('reg.example.com', undefined, fetchFn);
    await get('/v2/_catalog');
    expect(fetchFn.requests[0].headers).toEqual({});
  });
});

describe('createRegistryClient link handling', () => {
  it('sends credentials only to the registry host, even for absolute Link URLs', async () => {
    const fetchFn = fakeFetch(() => ({ status: 200 }));
    const get = createRegistryClient('mirror.example.com:8443', 'dXNlcjpwdw==', fetchFn);

    await get('/v2/ns/repo/tags/list?n=1000');
    await get('https://other.example.net/v2/ns/repo/tags/list?last=b');
    await get('v2/ns/repo/tags/list?last=c');

    expect(fetchFn.requests.map((r) => r.url)).toEqual([
      'https://mirror.example.com:8443/v2/ns/repo/tags/list?n=1000',
      'https://other.example.net/v2/ns/repo/tags/list?last=b',
      'https://mirror.example.com:8443/v2/ns/repo/tags/list?last=c',
    ]);
    expect(fetchFn.requests[0].headers.Authorization).toBe('Basic dXNlcjpwdw==');
    expect(fetchFn.requests[1].headers.Authorization).toBeUndefined();
    expect(fetchFn.requests[2].headers.Authorization).toBe('Basic dXNlcjpwdw==');
  });

  it('refuses a non-https Link URL instead of crashing in the transport', async () => {
    const fetchFn = fakeFetch(() => ({ status: 200 }));
    const get = createRegistryClient('mirror.example.com', undefined, fetchFn);
    await expect(get('http://mirror.example.com/v2/x/tags/list')).rejects.toMatchObject({
      name: 'RegistryHttpError',
    });
    expect(fetchFn.requests).toEqual([]);
  });
});
