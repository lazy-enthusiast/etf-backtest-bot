// OpenRouter 呼叫經 Vercel proxy；API Key 只在 Proxy 端
const DEFAULT_PROXY_URL = 'https://deep-water-proxy.vercel.app/api/chat';

export async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function proxyUrl(env) {
  return env.PROXY_URL || DEFAULT_PROXY_URL;
}

function buildProxyHeaders(env) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (env.PROXY_SECRET) {
    headers['X-Proxy-Secret'] = env.PROXY_SECRET;
  }
  return headers;
}

export async function callOpenRouterSync(env, body, timeoutMs = 55000) {
  const r = await fetchWithTimeout(proxyUrl(env), {
    method: 'POST',
    headers: buildProxyHeaders(env),
    body: JSON.stringify(body)
  }, timeoutMs);

  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`OpenRouter Sync Error (${r.status}): ${errText}`);
  }
  return r.json();
}

export async function callOpenRouterStream(env, body) {
  const response = await fetch(proxyUrl(env), {
    method: 'POST',
    headers: buildProxyHeaders(env),
    body: JSON.stringify({ ...body, stream: true })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter Stream Error (${response.status}): ${errText}`);
  }
  return response.body;
}
