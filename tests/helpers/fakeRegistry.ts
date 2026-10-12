import type { RegistryGet, RegistryResponse } from '../../server/registryAuth.js';

export interface FakeRegistryOptions {
  /** Repository name to tag list. */
  repos: Record<string, string[]>;
  /** When false, /v2/_catalog answers 403 like many hardened registries. Default true. */
  catalogListing?: boolean;
  /** Page size for tags and catalog listings. Default: everything in one page. */
  pageSize?: number;
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): RegistryResponse {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    header: (name) => headers[name.toLowerCase()] ?? null,
    text: async () => text,
  };
}

export function createFakeRegistry(options: FakeRegistryOptions): RegistryGet & { calls: string[] } {
  const { repos, catalogListing = true, pageSize } = options;
  const calls: string[] = [];

  const get: RegistryGet = async (pathOrUrl) => {
    calls.push(pathOrUrl);
    const url = new URL(pathOrUrl, 'https://fake-registry.example.com');
    const last = url.searchParams.get('last');

    const paginate = (key: string, items: string[], basePath: string) => {
      const start = last ? items.indexOf(last) + 1 : 0;
      const size = pageSize ?? Math.max(items.length, 1);
      const slice = items.slice(start, start + size);
      const headers: Record<string, string> = {};
      if (start + size < items.length) {
        headers.link = `<${basePath}?n=${size}&last=${slice[slice.length - 1]}>; rel="next"`;
      }
      return respond(200, { [key]: slice }, headers);
    };

    if (url.pathname === '/v2/_catalog') {
      if (!catalogListing) return respond(403, { errors: [] });
      return paginate('repositories', Object.keys(repos), '/v2/_catalog');
    }

    const match = url.pathname.match(/^\/v2\/(.+)\/tags\/list$/);
    if (match && repos[match[1]]) {
      return paginate('tags', repos[match[1]], `/v2/${match[1]}/tags/list`);
    }
    return respond(404, { errors: [] });
  };

  return Object.assign(get, { calls });
}
