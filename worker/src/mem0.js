import { fetchWithTimeout } from './openrouter.js';

export async function mem0Search(env, query) {
  if (!env.MEM0_API_KEY || !env.MEM0_USER_ID) return '';
  try {
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

    if (memories.length > 0) return memories.join('\n');
    return await mem0GetAll(env);
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
