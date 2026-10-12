import https from 'https';

export interface RegistryResponse {
  ok: boolean;
  status: number;
  header(name: string): string | null;
  text(): Promise<string>;
}

export interface RegistryRequestInit {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type RegistryFetch = (url: string, init?: RegistryRequestInit) => Promise<RegistryResponse>;

/** GET against the registry. A path starting with `/` is resolved against the registry host. */
export type RegistryGet = (pathOrUrl: string) => Promise<RegistryResponse>;

export class RegistryHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'RegistryHttpError';
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 10000;

/** Global fetch with TLS verification. Used by the verify route. */
export const verifiedFetch: RegistryFetch = async (url, init = {}) => {
  const res = await fetch(url, {
    headers: init.headers,
    signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  return {
    ok: res.ok,
    status: res.status,
    header: (name) => res.headers.get(name),
    text: () => res.text(),
  };
};

/**
 * GET with certificate verification disabled. Private mirror registries are often
 * self-signed; this matches the --src-tls-verify=false used for mirror runs.
 */
export const insecureFetch: RegistryFetch = (url, init = {}) =>
  new Promise((resolve, reject) => {
    const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const req = https.get(
      url,
      { headers: init.headers, rejectUnauthorized: false, timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            header: (name) => {
              const value = res.headers[name.toLowerCase()];
              return Array.isArray(value) ? value.join(', ') : (value ?? null);
            },
            text: async () => body,
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(
        Object.assign(new Error(`Request to ${url} timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }),
      );
    });
    req.on('error', reject);
  });

export interface AuthChallenge {
  realm: string;
  service?: string;
  scope?: string;
}

export function parseAuthChallenge(header: string | null): AuthChallenge | null {
  if (!header) return null;
  const attribute = (key: string): string | undefined =>
    header.match(new RegExp(`${key}="([^"]*)"`))?.[1];
  const realm = attribute('realm');
  if (!realm) return null;
  return { realm, service: attribute('service'), scope: attribute('scope') };
}

type TokenResult =
  | { ok: true; token: string | null }
  | { ok: false; status: number; body: string };

async function fetchToken(
  challenge: AuthChallenge,
  authBase64: string | undefined,
  fetchFn: RegistryFetch,
): Promise<TokenResult> {
  const tokenUrl = new URL(challenge.realm);
  if (challenge.service) tokenUrl.searchParams.set('service', challenge.service);
  if (challenge.scope) tokenUrl.searchParams.set('scope', challenge.scope);
  const headers: Record<string, string> = authBase64 ? { Authorization: `Basic ${authBase64}` } : {};

  const res = await fetchFn(tokenUrl.toString(), { headers });
  const body = await res.text().catch(() => '');
  if (!res.ok) return { ok: false, status: res.status, body };

  try {
    const parsed = JSON.parse(body) as { token?: string; access_token?: string };
    return { ok: true, token: parsed.token ?? parsed.access_token ?? null };
  } catch {
    return { ok: true, token: null };
  }
}

export type AuthResult = { ok: true; authorization?: string } | { ok: false; error: string };

/** Docker v2 auth probe against `/v2/`. Error strings are part of the verify route contract. */
export async function authenticateRegistry(
  registry: string,
  authBase64: string | undefined,
  fetchFn: RegistryFetch,
): Promise<AuthResult> {
  const basic = authBase64 ? `Basic ${authBase64}` : undefined;
  const res = await fetchFn(`https://${registry}/v2/`, {
    headers: basic ? { Authorization: basic } : {},
  });
  if (res.ok) return { ok: true, authorization: basic };

  if (res.status === 401) {
    const challenge = parseAuthChallenge(res.header('www-authenticate'));
    if (challenge) {
      const token = await fetchToken(challenge, authBase64, fetchFn);
      if (token.ok) {
        return { ok: true, authorization: token.token ? `Bearer ${token.token}` : undefined };
      }
      return { ok: false, error: `Authentication failed (${token.status}): ${token.body.slice(0, 200)}` };
    }
  }
  return { ok: false, error: `HTTP ${res.status}` };
}

/**
 * Registry GET helper that answers bearer challenges. A token is scoped to what the
 * 401 asked for, so each new repository triggers its own token request.
 */
export function createRegistryClient(
  registry: string,
  authBase64: string | undefined,
  fetchFn: RegistryFetch,
): RegistryGet {
  let authorization = authBase64 ? `Basic ${authBase64}` : undefined;

  return async (pathOrUrl) => {
    // Link headers may carry absolute or host-relative URLs; resolve them against the registry.
    const url = new URL(pathOrUrl, `https://${registry}`);
    if (url.protocol !== 'https:') {
      throw new RegistryHttpError(502, `Refusing non-https registry URL ${url.origin}`);
    }
    // Credentials belong to the registry; never forward them to another host.
    const sameHost = url.host === new URL(`https://${registry}`).host;
    const send = () =>
      fetchFn(url.toString(), {
        headers: sameHost && authorization ? { Authorization: authorization } : {},
      });

    const res = await send();
    if (res.status !== 401 || !sameHost) return res;

    const challenge = parseAuthChallenge(res.header('www-authenticate'));
    if (!challenge) return res;

    try {
      const token = await fetchToken(challenge, authBase64, fetchFn);
      if (!token.ok || !token.token) return res;
      authorization = `Bearer ${token.token}`;
    } catch {
      // Not a bearer realm (for example a Basic-only challenge): surface the original 401.
      return res;
    }
    return send();
  };
}
