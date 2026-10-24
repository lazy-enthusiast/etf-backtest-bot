import { fetchWithTimeout } from './openrouter.js';

const MEM0_CACHE_TTL = 600; // 10 分鐘

function mem0CacheKey(userId, query) {
  const q = String(query || '').trim().slice(0, 200).toLowerCase();
  return new Request(`https://mem0-cache.invalid/${encodeURIComponent(userId)}/${encodeURIComponent(q)}`, { method: 'GET' });
}

export async function mem0Search(env, query, { skip = false } = {}) {
  if (skip) return '';
  if (!env.MEM0_API_KEY || !env.MEM0_USER_ID) return '';
  try {
    const cache = caches.default;
    const key = mem0CacheKey(env.MEM0_USER_ID, query);
    const hit = await cache.match(key);
    if (hit) return await hit.text();

    const r = await fetchWithTimeout('https://api.mem0.ai/v1/memories/search/', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${env.MEM0_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, user_id: env.MEM0_USER_ID, limit: 5 })
    }, 8000);

    const data = await r.json();
    const list = Array.isArray(data) ? data : (data?.results || data?.result || []);
    const memories = list.map(x => x.memory || x.text).filter(Boolean);

    let text = memories.length > 0 ? memories.join('\n') : await mem0GetAll(env);
    if (text) {
      const cached = new Response(text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': `public, max-age=${MEM0_CACHE_TTL}` }
      });
      // waitUntil 由呼叫端負責較乾淨；此處 fire-and-forget 即可
      cache.put(key, cached).catch(() => {});
    }
    return text;
  } catch (err) {
    return '';
  }
}

async function mem0GetAll(env) {
  if (!env.MEM0_API_KEY || !env.MEM0_USER_ID) return '';
  try {
    const r = await fetchWithTimeout(`https://api.mem0.ai/v1/memories/?user_id=${env.MEM0_USER_ID}&page_size=10`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${env.MEM0_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }, 8000);
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data?.results || []);
    return list.map(x => x.memory || x.text).filter(Boolean).join('\n');
  } catch (err) {
    return '';
  }
}

export function mem0Add(env, userText, aiText) {
  if (!env.MEM0_API_KEY || !env.MEM0_USER_ID) return Promise.resolve();
  const trimmedAiText = aiText.length > 2000 ? aiText.slice(0, 2000) + '...[內容過長，已截斷]' : aiText;
  return fetchWithTimeout('https://api.mem0.ai/v1/memories/', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${env.MEM0_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      user_id: env.MEM0_USER_ID,
      messages: [
        { role: 'user', content: userText },
        { role: 'assistant', content: trimmedAiText }
      ]
    })
  }, 10000).catch(err => console.error('Mem0 Add Error:', err));
}
