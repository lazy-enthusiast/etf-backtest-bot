// ALLOWED_ORIGIN 可為逗號分隔清單；請求來源在清單內才回傳該來源
export function resolveAllowedOrigin(env, request) {
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.includes('*')) return '*';
  const origin = request.headers.get('Origin');
  return allowed.includes(origin) ? origin : allowed[0];
}

export function getCorsHeaders(env, request) {
  return {
    'Access-Control-Allow-Origin': resolveAllowedOrigin(env, request),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Auth',
    'Access-Control-Expose-Headers': 'X-Used-Model, X-Complexity, X-Task-Tag'
  };
}
