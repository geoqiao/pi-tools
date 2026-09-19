// Quota HTTP is a narrow read/auth boundary. It never sends usage records and
// never follows a redirect to a destination outside this allow-list.

const ALLOWED_DESTINATIONS = Object.freeze([
  { origin: 'https://api.kimi.com', pathname: '/coding/v1/usages', method: 'GET' },
  { origin: 'https://auth.kimi.com', pathname: '/api/oauth/token', method: 'POST' },
  { origin: 'https://open.bigmodel.cn', pathname: '/api/monitor/usage/quota/limit', method: 'GET' },
  { origin: 'https://api.z.ai', pathname: '/api/monitor/usage/quota/limit', method: 'GET' },
]);

export class QuotaOfflineError extends Error {
  constructor() {
    super('offline mode: quota network requests are disabled');
    this.name = 'QuotaOfflineError';
  }
}

function destinationFor(url, method) {
  return ALLOWED_DESTINATIONS.find(destination => (
    destination.origin === url.origin
      && destination.pathname === url.pathname
      && destination.method === method
      && !url.search
      && !url.hash
  ));
}

function validOAuthBody(body) {
  if (!(body instanceof URLSearchParams)) return false;
  const keys = [...body.keys()].sort();
  return keys.length === 3
    && keys[0] === 'client_id'
    && keys[1] === 'grant_type'
    && keys[2] === 'refresh_token'
    && body.get('grant_type') === 'refresh_token'
    && Boolean(body.get('client_id'))
    && Boolean(body.get('refresh_token'));
}

export function isAllowedQuotaURL(input, method = 'GET') {
  try {
    const url = new URL(input);
    return Boolean(destinationFor(url, String(method).toUpperCase()));
  } catch {
    return false;
  }
}

export async function quotaFetch(input, options = {}, {
  fetchImpl = globalThis.fetch,
  offline = process.env.PI_USAGE_OFFLINE === '1',
} = {}) {
  if (offline) throw new QuotaOfflineError();
  const url = new URL(input);
  const method = String(options.method || 'GET').toUpperCase();
  const destination = destinationFor(url, method);
  if (!destination || url.username || url.password) {
    throw new Error('blocked quota network destination');
  }
  if (method === 'GET' && options.body != null) {
    throw new Error('blocked quota request body');
  }
  if (destination.origin === 'https://auth.kimi.com' && !validOAuthBody(options.body)) {
    throw new Error('blocked quota auth request');
  }
  return fetchImpl(url.toString(), { ...options, redirect: 'error' });
}
