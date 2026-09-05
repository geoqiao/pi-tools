// The only network boundary: retrieve source data, never send collected usage.
export async function sourceFetch(input, options = {}) {
  if (process.env.PI_USAGE_OFFLINE === '1') throw new Error('离线模式：已禁用数据源网络请求');
  const url = new URL(input);
  const method = (options.method || 'GET').toUpperCase();
  const cursor = url.origin === 'https://cursor.com'
    && url.pathname === '/api/dashboard/export-usage-events-csv'
    && url.search === '?strategy=tokens'
    && method === 'GET' && options.body == null;
  const rpc = url.protocol === 'http:' && url.hostname === '127.0.0.1'
    && /^\/exa\.language_server_pb\.LanguageServerService\/(GetWorkspaceInfos|GetCascadeTrajectory)$/.test(url.pathname)
    && !url.search && method === 'POST';
  if (url.username || url.password || url.hash || (!cursor && !rpc)) {
    throw new Error('已阻止非数据源请求');
  }
  if (rpc) {
    const body = JSON.parse(options.body || '{}');
    const keys = Object.keys(body);
    if (url.pathname.endsWith('/GetWorkspaceInfos') ? keys.length !== 0
      : keys.length !== 1 || typeof body.cascadeId !== 'string') {
      throw new Error('已阻止非只读 RPC 参数');
    }
  }
  return fetch(url, { ...options, redirect: 'error' });
}
