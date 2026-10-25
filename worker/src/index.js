import { SHARED_CORE_SYSTEM, SUMMARIZER_SYSTEM, MODEL_CONFIG, DEFAULT_MODEL_KEY } from './brain.js';
import { getCorsHeaders } from './cors.js';
import { isAuthorized } from './auth.js';
import { mem0Search, mem0Add } from './mem0.js';
import { callOpenRouterSync, callOpenRouterStream } from './openrouter.js';
import { fetchFromYahoo, normalizeSymbol, SYMBOL_RE } from './yahoo.js';
import {
  skeletonizeLastReply,
  shouldSkipSummarizer,
  estimateComplexity,
  shouldSearchMem0
} from './context-budget.js';
import { maybeRunTools } from './tools.js';

const SERIES_CACHE_TTL = 86400; // 24h；日線歷史夠用

function parseSummaryResponse(raw, fallbackSummary) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const jsonStr = match ? match[0] : raw;
    const parsed = JSON.parse(jsonStr);
    return {
      history_summary: typeof parsed.history_summary === 'string' ? parsed.history_summary : (fallbackSummary || ''),
      complexity: Number.isFinite(parsed.complexity) ? parsed.complexity : 5,
      task_tag: typeof parsed.task_tag === 'string' ? parsed.task_tag : ''
    };
  } catch (err) {
    return {
      history_summary: raw || fallbackSummary || '',
      complexity: 5,
      task_tag: ''
    };
  }
}

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BACKTEST_CONTEXT_CHARS = 12000;

function buildAttachmentBlock(attachment) {
  if (!attachment || !attachment.dataUrl) return null;
  if (attachment.mimeType === 'application/pdf') {
    return {
      type: 'file',
      file: { filename: attachment.filename || 'document.pdf', file_data: attachment.dataUrl }
    };
  }
  if (SUPPORTED_IMAGE_TYPES.includes(attachment.mimeType)) {
    return { type: 'image_url', image_url: { url: attachment.dataUrl } };
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = getCorsHeaders(env, request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ===== GET /api/models（公開，不驗證暗號）=====
    if (url.pathname === '/api/models' && request.method === 'GET') {
      const models = Object.entries(MODEL_CONFIG).map(([key, cfg]) => ({
        key,
        label: cfg.label,
        description: cfg.description
      }));
      return new Response(JSON.stringify({ models, default: DEFAULT_MODEL_KEY }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // ===== GET /api/auth-check（前端登入時驗證密碼，不呼叫任何模型）=====
    if (url.pathname === '/api/auth-check' && request.method === 'GET') {
      const ok = isAuthorized(request, env);
      return new Response(JSON.stringify({ ok }), {
        status: ok ? 200 : 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // ===== GET /api/series?symbol=XXX（Yahoo 代抓；需驗證；Cache API 24h）=====
    if (url.pathname === '/api/series' && request.method === 'GET') {
      if (!isAuthorized(request, env)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      const symbol = normalizeSymbol(url.searchParams.get('symbol'));
      if (!SYMBOL_RE.test(symbol)) {
        return new Response(JSON.stringify({ error: '無效代號' }), {
          status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      try {
        const cache = caches.default;
        const cacheKey = new Request(`https://series-cache.invalid/yahoo/${symbol}`, { method: 'GET' });
        const hit = await cache.match(cacheKey);
        if (hit) {
          const body = await hit.text();
          return new Response(body, {
            headers: {
              'Content-Type': 'application/json',
              'X-Series-Cache': 'HIT',
              ...corsHeaders
            }
          });
        }
        const data = await fetchFromYahoo(symbol);
        const body = JSON.stringify(data);
        const cached = new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${SERIES_CACHE_TTL}`
          }
        });
        ctx.waitUntil(cache.put(cacheKey, cached.clone()));
        return new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'X-Series-Cache': 'MISS',
            ...corsHeaders
          }
        });
      } catch (err) {
        const status = err.status === 404 ? 404 : 502;
        const hint = status === 502 ? '（Yahoo 可能暫時拒答，請稍後再試）' : '';
        return new Response(JSON.stringify({ error: (err.message || '抓取失敗') + hint }), {
          status, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // ===== /upload（R2；前端目前未使用，保留給日後附件落地）=====
    if (url.pathname === '/upload' && request.method === 'POST') {
      if (!isAuthorized(request, env)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
      try {
        const formData = await request.formData();
        const file = formData.get('file');
        if (!file) {
          return new Response(JSON.stringify({ error: '未收到檔案' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        if (env.MY_BUCKET) {
          await env.MY_BUCKET.put(file.name, file.stream(), {
            httpMetadata: { contentType: file.type }
          });
        }
        return new Response(JSON.stringify({
          success: true, filename: file.name, message: '檔案已成功上傳至 R2 Storage！'
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    if (!isAuthorized(request, env)) {
      return new Response(JSON.stringify({ error: 'Unauthorized: 暗號不匹配或拒絕存取' }), {
        status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    try {
      const body = await request.json();
      const {
        query,
        historySummary,
        lastAiResponse,
        model,
        action,
        attachment,
        backtestContext,
        backtestUnchanged,
        lastComplexity
      } = body;

      const MAX_BASE64_LENGTH = 22 * 1024 * 1024;
      if (attachment?.dataUrl && attachment.dataUrl.length > MAX_BASE64_LENGTH) {
        return new Response(JSON.stringify({ error: '附件過大，請上傳 15MB 以內的檔案' }), {
          status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (action === 'generateTitle') {
        if (!query || typeof query !== 'string') {
          return new Response(JSON.stringify({ error: 'Missing query' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        const titleRes = await callOpenRouterSync(env, {
          model: 'meta-llama/llama-3.1-8b-instruct',
          temperature: 0.3,
          max_tokens: 50,
          messages: [
            { role: 'system', content: '你是一個標題生成器。請根據對話內容，生成一個3到5個字的繁體中文標題。嚴禁輸出引號、標點符號或任何解釋，只輸出標題文字本身。' },
            { role: 'user', content: `用戶提問：${query}\nAI回答：${(lastAiResponse || '').slice(0, 300)}` }
          ]
        });
        let rawTitle = titleRes?.choices?.[0]?.message?.content || '';
        rawTitle = rawTitle.replace(/["'「」《》\n\r]/g, '').trim();
        const title = rawTitle ? rawTitle.slice(0, 10) : query.slice(0, 12);
        return new Response(JSON.stringify({ title }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      const lastSkeleton = skeletonizeLastReply(lastAiResponse);
      const skipSummarizer = shouldSkipSummarizer({
        query,
        historySummary,
        backtestUnchanged: !!backtestUnchanged,
        hasAttachment: !!attachment
      });
      const searchMem0 = shouldSearchMem0(query, {
        backtestUnchanged: !!backtestUnchanged,
        skipSummarizer
      });

      const attachmentNote = attachment ? `\n【附件】：${attachment.filename || '未命名'}（交由回答模型處理）` : '';
      const backtestHint = backtestUnchanged
        ? '【回測】與上輪相同，未重送全文。'
        : (typeof backtestContext === 'string' && backtestContext
          ? '【回測】本輪有更新（詳見回答模型脈絡中的回測結果，此處不重複貼全文）。'
          : '【回測】尚未回測。');

      let newSummary = historySummary || '';
      let complexity = estimateComplexity(query, Number.isFinite(lastComplexity) ? lastComplexity : 5);
      let task_tag = skipSummarizer ? 'continue' : '';
      let rawSummaryContent = skipSummarizer ? '{"skipped":true}' : '';
      let longTermMemory = '';

      const mem0Promise = mem0Search(env, query, { skip: !searchMem0 });

      if (!skipSummarizer) {
        const [summaryRes, mem0Text] = await Promise.all([
          callOpenRouterSync(env, {
            model: 'deepseek/deepseek-v4-flash',
            temperature: 0.1,
            top_p: 0.6,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SUMMARIZER_SYSTEM },
              {
                role: 'user',
                content:
                  `【既有背景】：\n${historySummary || '（無）'}\n\n` +
                  `【本輪增量】\n` +
                  `- 用戶意圖：${String(query || '').slice(0, 500)}${attachmentNote}\n` +
                  `- ${backtestHint}\n` +
                  `- 上一輪回覆骨架：\n${lastSkeleton}`
              }
            ]
          }),
          mem0Promise
        ]);
        rawSummaryContent = summaryRes?.choices?.[0]?.message?.content || '';
        const parsed = parseSummaryResponse(rawSummaryContent, historySummary);
        newSummary = parsed.history_summary;
        complexity = parsed.complexity;
        task_tag = parsed.task_tag;
        longTermMemory = mem0Text;
      } else {
        longTermMemory = await mem0Promise;
      }

      // 舊前端若仍送 auto，一律改回預設 DeepSeek（不再依複雜度自動升 Sonnet）
      let selectedModelKey = (!model || model === 'auto') ? DEFAULT_MODEL_KEY : model;
      const cfg = MODEL_CONFIG[selectedModelKey] || MODEL_CONFIG[DEFAULT_MODEL_KEY];

      let backtestText;
      if (backtestUnchanged) {
        backtestText = '（與上輪相同，未重送。請依對話背景與上一輪骨架中的數字繼續；若需精確數字請使用者重算。）';
      } else {
        backtestText = typeof backtestContext === 'string' ? backtestContext.slice(0, MAX_BACKTEST_CONTEXT_CHARS) : '';
      }
      const dynamicContextText =
        `【長期記憶】：\n${longTermMemory || '（無）'}\n\n` +
        `【對話背景】：\n${newSummary || '（無）'}\n\n` +
        `【上一輪回覆（骨架）】：\n${lastSkeleton}\n\n` +
        `【目前狀態與回測】：\n${backtestText || '（尚未回測）'}`;

      const attachmentBlock = buildAttachmentBlock(attachment);
      const userMessageContent = attachmentBlock
        ? [{ type: 'text', text: query }, attachmentBlock]
        : query;

      const toolMessages = await maybeRunTools(env, cfg, dynamicContextText, query);

      const answerBody = {
        model: cfg.model,
        max_tokens: cfg.max_tokens,
        messages: [
          {
            role: 'system',
            content: [
              {
                type: 'text',
                text: SHARED_CORE_SYSTEM,
                cache_control: { type: 'ephemeral' }
              },
              {
                type: 'text',
                text: dynamicContextText
              }
            ]
          },
          {
            role: 'user',
            content: userMessageContent
          },
          ...(toolMessages || [])
        ]
      };

      if (cfg.temperature !== undefined) answerBody.temperature = cfg.temperature;
      if (cfg.reasoning) answerBody.reasoning = cfg.reasoning;
      if (attachment && attachment.mimeType === 'application/pdf') {
        answerBody.plugins = [{ id: 'file-parser', pdf: { engine: 'native' } }];
      }

      const stream = await callOpenRouterStream(env, answerBody);

      let fullAnswerText = '';
      let sseBuffer = '';

      const transformStream = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          sseBuffer += new TextDecoder().decode(chunk, { stream: true });
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
              try {
                const data = JSON.parse(trimmed.slice(6));
                const delta = data.choices?.[0]?.delta?.content;
                if (delta) fullAnswerText += delta;
              } catch (e) {}
            }
          }
        },
        flush() {
          if (fullAnswerText) {
            ctx.waitUntil(mem0Add(env, query, fullAnswerText));
          }
        }
      });

      const metaEvent = `data: ${JSON.stringify({
        type: 'meta',
        history_summary: newSummary,
        complexity: complexity,
        task_tag: task_tag,
        raw_summary: rawSummaryContent,
        used_model: selectedModelKey
      })}\n\n`;

      const tokenStream = stream.pipeThrough(transformStream);
      const combinedStream = new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode(metaEvent));
          const reader = tokenStream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } finally {
            controller.close();
          }
        }
      });

      return new Response(combinedStream, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Used-Model': selectedModelKey
        }
      });

    } catch (err) {
      const isTimeout = err.name === 'AbortError';
      return new Response(JSON.stringify({
        error: isTimeout ? '上游服務逾時，請稍後再試' : err.message
      }), {
        status: isTimeout ? 504 : 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};
