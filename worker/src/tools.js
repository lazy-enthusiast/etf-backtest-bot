// AI function calling：代號歷史查詢（Worker 端可執行）

import { callOpenRouterSync } from './openrouter.js';
import { fetchFromYahoo, normalizeSymbol } from './yahoo.js';
import { SHARED_CORE_SYSTEM } from './brain.js';

export const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_ticker_history',
      description:
        '查詢某投資代號在 Yahoo 的可用歷史起點、名稱與幣別。建議 portfolio 前若不確定長歷史，先呼叫。倫敦 .L、港股 .HK、美股 .US。',
      parameters: {
        type: 'object',
        properties: {
          ticker: {
            type: 'string',
            description: '代號.交易所，例如 VTI.US、VWRD.L、IGLN.L'
          }
        },
        required: ['ticker']
      }
    }
  }
];

export async function runToolCall(name, argsJson) {
  let args = {};
  try {
    args = typeof argsJson === 'string' ? JSON.parse(argsJson || '{}') : (argsJson || {});
  } catch (e) {
    return { error: '參數 JSON 無效' };
  }
  if (name === 'get_ticker_history') {
    const ticker = normalizeSymbol(args.ticker);
    if (!ticker) return { error: '缺少 ticker' };
    try {
      const data = await fetchFromYahoo(ticker);
      return {
        ticker,
        yahooSymbol: data.resolvedFrom || data.symbol,
        name: data.name,
        currency: data.currency,
        instrumentType: data.instrumentType,
        firstDate: data.firstDate,
        lastDate: data.lastDate,
        points: data.series?.length || 0,
        note: '此為 Yahoo 序列本身起點；前端若有 index-mapping 替代序列，回測還可能往前延伸。'
      };
    } catch (err) {
      return { ticker, error: err.message || String(err) };
    }
  }
  return { error: `未知工具：${name}` };
}

/**
 * Sonnet 等支援 tools 的模型：先同步一輪看是否要查代號，再把 tool 結果併入後續 stream messages。
 * @returns {Promise<object[]|null>} 要插入 user 訊息之前的 assistant+tool messages
 */
export async function maybeRunTools(env, cfg, dynamicContextText, query) {
  if (!/claude|anthropic/i.test(cfg.model)) return null;
  // 與代號／組合無關的短續問不跑工具，省延遲
  if (!/(代號|ETF|組合|portfolio|權重|VTI|VT\.|IEF|GLD|VWRD|IGLN|回測|持倉|\.US|\.L|\.HK)/i.test(String(query || ''))
    && String(query || '').length < 80) {
    return null;
  }

  let probe;
  try {
    probe = await callOpenRouterSync(env, {
      model: cfg.model,
      max_tokens: 1000,
      tools: AI_TOOLS,
      tool_choice: 'auto',
      messages: [
        {
          role: 'system',
          content: SHARED_CORE_SYSTEM + '\n\n本回合只允許呼叫 get_ticker_history 或什麼都不呼叫；不要寫給使用者的完整分析。'
        },
        { role: 'system', content: dynamicContextText },
        {
          role: 'user',
          content: `${query}\n\n若你打算建議／修改任何 ETF 代號且對其 Yahoo 歷史起點沒把握，請呼叫 get_ticker_history（可多次）。若已從脈絡充分知情，請直接回覆一句「無需工具」。`
        }
      ]
    }, 50000);
  } catch (e) {
    return null;
  }

  const choice = probe?.choices?.[0]?.message;
  const calls = choice?.tool_calls;
  if (!Array.isArray(calls) || !calls.length) return null;

  const out = [{ role: 'assistant', content: choice.content || null, tool_calls: calls }];
  for (const call of calls.slice(0, 5)) {
    const fn = call.function?.name || call.name;
    const argStr = call.function?.arguments || call.arguments || '{}';
    const result = await runToolCall(fn, argStr);
    out.push({
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify(result)
    });
  }
  return out;
}
