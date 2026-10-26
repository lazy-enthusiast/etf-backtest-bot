// ALLOWED_ORIGIN 可為逗號分隔清單；另允許本機任意埠（Live Server 等）

function isLocalDevOrigin(origin) {
  try {
    const u = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(u.hostname);
  } catch (_) {
    return false;
  }
}

export function resolveAllowedOrigin(env, request) {
  const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.includes('*')) return '*';
  const origin = request.headers.get('Origin');
  if (!origin) return allowed[0] || '*';
  if (allowed.includes(origin) || isLocalDevOrigin(origin)) return origin;
  // 不符時不要回傳「清單第一個」誤導瀏覽器；回 echo 拒絕語意用固定清單首項仍會 CORS 失敗
  return allowed[0];
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
