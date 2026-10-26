import { WORKER_URL, STORE } from './config.js';
import { state } from './state.js';
import { $, el } from './dom.js';
import { loadJSON, saveJSON } from './storage.js';
import { getAuth, showAuthDialog, handleUnauthorized } from './auth.js';
import { buildBacktestContext } from './context.js';
import {
  parsePortfolioBlock, parsePlanBlock, buildPortfolioCard, buildPlanCard, maybeAutoApplyControls
} from './ai-controls.js';

function toggleAdvisor(force) {
  const open = force ?? !document.body.classList.contains('advisor-open');
  document.body.classList.toggle('advisor-open', open);
}

export let MODEL_NAMES = {};
export let conversations = loadJSON(STORE.conversations, []).filter(c => c && c.id && Array.isArray(c.messages));
export let activeId = localStorage.getItem(STORE.activeConv);
export let pendingAttachment = null;

export async function loadModels() {
  const res = await fetch(`${WORKER_URL}api/models`);
  const data = await res.json();
  const select = $('modelSelect');
  select.innerHTML = '';
  MODEL_NAMES = {};
  const keys = new Set();
  (data.models || []).forEach(m => {
    const o = el('option', '', `${m.label}（${m.description}）`);
    o.value = m.key;
    if (m.key === data.default) o.selected = true;
    select.appendChild(o);
    MODEL_NAMES[m.key] = m.label;
    keys.add(m.key);
  });
  const fallback = data.default || 'DeepSeek-V4.1-Flash';
  // 舊對話若選了已移除的模型（auto／Haiku 等），改回預設
  let changed = false;
  conversations.forEach(c => {
    if (!c.model || !keys.has(c.model)) { c.model = fallback; changed = true; }
  });
  if (changed) saveConversations();
}

export function saveConversations() {
  const toSave = conversations.map(({ lastAttachment, lastQuery, ...rest }) => rest);
  saveJSON(STORE.conversations, toSave);
  if (activeId) localStorage.setItem(STORE.activeConv, activeId);
}

export function getActiveConv() { return conversations.find(c => c.id === activeId); }

async function hashText(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text || ''));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function newConversation() {
  const conv = {
    id: Date.now().toString(),
    title: '新對話',
    model: $('modelSelect').value || 'DeepSeek-V4.1-Flash',
    historySummary: '',
    lastBacktestHash: '',
    lastComplexity: null,
    messages: []
  };
  conversations.unshift(conv);
  activeId = conv.id;
  saveConversations();
  renderConvSelect();
  renderMessages();
}

export function switchConversation(id) {
  activeId = id;
  saveConversations();
  renderMessages();
}

export function renderConvSelect() {
  const select = $('convSelect');
  select.innerHTML = '';
  conversations.forEach(c => {
    const o = el('option', '', c.title);
    o.value = c.id;
    select.appendChild(o);
  });
  select.value = activeId;
  updateAdvSettingsSummary();
}

export function updateAdvSettingsSummary() {
  const node = $('advSettingsSummary');
  if (!node) return;
  const conv = getActiveConv();
  const title = conv?.title || '對話';
  const modelSel = $('modelSelect');
  const modelLabel = modelSel?.selectedOptions?.[0]?.textContent?.trim()
    || modelSel?.value
    || conv?.model
    || '模型';
  node.textContent = `${title} · ${modelLabel}`;
}

export function toggleAdvSettings() {
  const panel = $('advSettingsPanel');
  const btn = $('advSettingsToggle');
  if (!panel || !btn) return;
  const open = panel.hasAttribute('hidden');
  if (open) panel.removeAttribute('hidden');
  else panel.setAttribute('hidden', '');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function toggleConvMenu(e) {
  e.stopPropagation();
  const host = $('convMenu');
  const existing = host.querySelector('.menu');
  if (existing) { existing.remove(); return; }
  const menu = el('div', 'menu');
  const rename = el('button', '', '重新命名');
  rename.onclick = () => {
    const conv = getActiveConv();
    const t = conv && prompt('新的對話名稱：', conv.title);
    if (t && t.trim()) { conv.title = t.trim(); saveConversations(); renderConvSelect(); }
    menu.remove();
  };
  const del = el('button', 'danger', '刪除對話');
  del.onclick = () => {
    menu.remove();
    if (!confirm('確定要刪除這個對話嗎？')) return;
    conversations = conversations.filter(c => c.id !== activeId);
    if (!conversations.length) { newConversation(); return; }
    activeId = conversations[0].id;
    saveConversations();
    renderConvSelect();
    renderMessages();
  };
  menu.append(rename, del);
  host.appendChild(menu);
}
export function changeModel() {
  const conv = getActiveConv();
  if (!conv) return;
  conv.model = $('modelSelect').value;
  saveConversations();
  updateAdvSettingsSummary();
}

export function formatTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '';
}

export function renderMarkdown(container, text) {
  const source = String(text ?? '');
  try {
    container.innerHTML = DOMPurify.sanitize(marked.parse(source));
    container.querySelectorAll('pre code.language-portfolio').forEach(code => {
      try {
        const pf = parsePortfolioBlock(code.textContent);
        if (pf && code.parentElement) code.parentElement.replaceWith(buildPortfolioCard(pf));
      } catch (e) {}
    });
    container.querySelectorAll('pre code.language-plan').forEach(code => {
      try {
        const plan = parsePlanBlock(code.textContent);
        if (plan && code.parentElement) code.parentElement.replaceWith(buildPlanCard(plan));
      } catch (e) {}
    });
    container.querySelectorAll('pre code').forEach(code => {
      try {
        const lang = (code.className.match(/language-(\w+)/) || [])[1] || 'code';
        if (!['portfolio', 'plan'].includes(lang) && hljs.getLanguage(lang)) hljs.highlightElement(code);
        const pre = code.parentElement;
        if (!pre) return;
        const box = el('div', 'code-box');
        const head = el('div', 'code-head');
        head.appendChild(el('span', '', lang));
        const copy = el('button', '', '複製');
        copy.onclick = () => navigator.clipboard.writeText(code.innerText).then(() => { copy.textContent = '✓ 已複製'; setTimeout(() => { copy.textContent = '複製'; }, 1200); });
        head.appendChild(copy);
        pre.replaceWith(box);
        box.append(head, pre);
      } catch (e) {}
    });
  } catch (e) {
    container.textContent = source;
  }
}

export function welcomeEl() {
  const box = el('div', 'welcome');
  box.appendChild(el('div', '', '✦'));
  box.appendChild(el('h3', '', '你好，我是你的退休顧問'));
  box.appendChild(el('div', 'small', '左側參數可手動改；我也能直接調整 ETF 權重、起始年與退休消費等假設並重算。'));
  const quick = el('div', 'quick');
  ['評估我目前的退休計劃', '把股債改成 70/30 並重算', '起始年改從 1980 開始', '退休年支出降到可達 95% 成功率', '怎樣把成功率提高到 95% 以上？']
    .forEach(q => { const b = el('button', '', q); b.onclick = () => sendMessage(q); quick.appendChild(b); });
  box.appendChild(quick);
  return box;
}

export function buildMessageEl(m, conv) {
  const wrap = el('div', 'msg ' + m.role);
  const bubble = el('div', 'bubble');
  if (m.pending) {
    bubble.appendChild(document.createTextNode(m.text || '思考中…'));
    bubble.appendChild(el('div', 'wait-status', '正在連線…'));
  } else if (m.role === 'bot') {
    try { renderMarkdown(bubble, m.text || ''); }
    catch (e) { bubble.textContent = m.text || ''; }
  } else {
    bubble.textContent = m.text ?? '';
  }
  wrap.appendChild(bubble);
  if (m.attachmentName) wrap.appendChild(el('div', 'attach-tag', '📎 ' + m.attachmentName));

  const meta = el('div', 'msg-meta');
  meta.appendChild(el('span', '', formatTime(m.time)));
  if (m.usedModel) meta.appendChild(el('span', '', `· ${MODEL_NAMES[m.usedModel] || m.usedModel}${Number.isFinite(m.complexity) ? `（評分 ${m.complexity}）` : ''}`));
  if (m.role !== 'error') {
    const copy = el('button', '', '複製');
    copy.onclick = () => navigator.clipboard.writeText(m.text).then(() => { copy.textContent = '✓'; setTimeout(() => { copy.textContent = '複製'; }, 1200); });
    meta.appendChild(copy);
  } else {
    const retry = el('button', '', '↻ 重新送出');
    retry.onclick = () => { conv.messages = conv.messages.filter(x => x !== m); resendLastQuery(conv); };
    meta.appendChild(retry);
  }
  wrap.appendChild(meta);

  if (m.summarizerRaw) {
    const d = el('details', 'debug');
    d.appendChild(el('summary', '', '摘要／評分過程'));
    let shown = m.summarizerRaw;
    try { shown = JSON.stringify(JSON.parse(m.summarizerRaw), null, 2); } catch (e) {}
    d.appendChild(el('pre', '', shown));
    wrap.appendChild(d);
  }
  return wrap;
}

export function renderMessages() {
  const box = $('messages');
  if (!box) return;
  const conv = getActiveConv();
  if (!conv) return;
  try {
    if ($('convSelect')) $('convSelect').value = conv.id;
    if ($('modelSelect')?.querySelector(`option[value="${conv.model}"]`)) $('modelSelect').value = conv.model;
    updateAdvSettingsSummary();
  } catch (e) {}
  const frag = document.createDocumentFragment();
  if (!conv.messages.length) frag.appendChild(welcomeEl());
  conv.messages.forEach(m => {
    try {
      frag.appendChild(buildMessageEl(m, conv));
    } catch (e) {
      const wrap = el('div', 'msg ' + (m.role || 'bot'));
      const fallback = el('div', 'bubble', m.pending ? '思考中…' : (m.text || '（這則訊息無法顯示）'));
      if (m.pending) fallback.appendChild(el('div', 'wait-status', '正在連線…'));
      wrap.appendChild(fallback);
      frag.appendChild(wrap);
    }
  });
  box.replaceChildren(frag);
  box.scrollTop = box.scrollHeight;
}

export async function fetchAutoTitle(conv, userQuery, aiAnswer) {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Auth': getAuth() },
      body: JSON.stringify({ action: 'generateTitle', query: userQuery, lastAiResponse: aiAnswer })
    });
    if (res.status === 401) { handleUnauthorized(); return; }
    const data = await res.json();
    if (res.ok && data.title) {
      conv.title = data.title.replace(/["']/g, '');
      saveConversations();
      renderConvSelect();
    }
  } catch (e) {
    console.error('標題生成失敗:', e);
  }
}

// ----- 附件（圖片／PDF 直接送模型；文字檔併入訊息）-----
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 40000;

export async function handleFileSelect(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > MAX_ATTACHMENT_BYTES) { alert('檔案過大，請上傳 15MB 以內的檔案。'); return; }
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (['.txt', '.csv', '.md'].includes(ext)) {
    const text = await file.text();
    pendingAttachment = { kind: 'text', filename: file.name, extractedText: text.length > MAX_EXTRACTED_CHARS ? text.slice(0, MAX_EXTRACTED_CHARS) + '\n…（已截斷）' : text };
    renderAttachPreview();
    return;
  }
  const mimeType = file.type || { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext];
  if (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) { alert('支援圖片（PNG／JPEG／WEBP）、PDF 與文字檔（.txt／.csv／.md）。'); return; }
  const reader = new FileReader();
  reader.onload = () => { pendingAttachment = { kind: 'binary', filename: file.name, mimeType, dataUrl: reader.result }; renderAttachPreview(); };
  reader.onerror = () => alert('讀取檔案失敗，請重試。');
  reader.readAsDataURL(file);
}

export function renderAttachPreview() {
  const box = $('attachPreview');
  box.innerHTML = '';
  box.hidden = !pendingAttachment;
  if (!pendingAttachment) return;
  box.appendChild(document.createTextNode('📎 ' + pendingAttachment.filename + ' '));
  const x = el('button', '', '✕');
  x.onclick = () => { pendingAttachment = null; renderAttachPreview(); };
  box.appendChild(x);
}

export async function resendLastQuery(conv) {
  if (!conv.lastQuery) { renderMessages(); return; }
  await doSend(conv, conv.lastQuery, conv.lastAttachment, lastBotText(conv), false);
}

export function lastBotText(conv) {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i];
    if (m.role === 'bot' && m.text && !m.pending && m.text !== '思考中…') return m.text;
  }
  return '';
}

export async function sendMessage(overrideText) {
  const text = overrideText !== undefined ? overrideText : $('inputBox').value.trim();
  if (!text || state.isSending) return;
  if (!getAuth()) { showAuthDialog(); return; }
  let conv = getActiveConv();
  if (!conv) { newConversation(); conv = getActiveConv(); }
  const isFirst = conv.messages.length === 0;
  const attachment = pendingAttachment;
  pendingAttachment = null;
  renderAttachPreview();
  const lastAi = lastBotText(conv);
  conv.lastQuery = text;
  conv.lastAttachment = attachment;
  conv.messages.push({ role: 'user', text, time: Date.now(), attachmentName: attachment?.filename });
  if (isFirst) conv.title = text.slice(0, 16);
  if (overrideText === undefined) { $('inputBox').value = ''; $('inputBox').style.height = 'auto'; }
  conversations = [conv, ...conversations.filter(c => c !== conv)];
  renderConvSelect();
  toggleAdvisor(true);
  await doSend(conv, text, attachment, lastAi, isFirst);
}

function explainError(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    if (typeof value.message === 'string' && value.message.trim()) return value.message.trim();
    try { return JSON.stringify(value); } catch (e) { /* ignore */ }
  }
  return fallback;
}

function paintFrame() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function waitUntilVisible(node) {
  const start = performance.now();
  while (node && performance.now() - start < 500) {
    const rect = node.getBoundingClientRect();
    const onScreen = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    if (onScreen) return;
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}

const MIN_THINKING_MS = 450;

function holdThinking(since) {
  const wait = MIN_THINKING_MS - (performance.now() - since);
  return wait > 0 ? new Promise(resolve => setTimeout(resolve, wait)) : Promise.resolve();
}

export async function doSend(conv, text, attachment, lastAiResponse, isFirst) {
  const botMsg = { role: 'bot', text: '思考中…', pending: true, time: Date.now() };
  conv.messages.push(botMsg);
  toggleAdvisor(true);
  state.isSending = true;
  const sendBtn = $('sendBtn');
  if (sendBtn) sendBtn.disabled = true;
  let bubble = null;
  let waitEl = null;
  let thinkingShownAt = performance.now();
  let sawHttp = false;
  let authFailed = false;
  try {
    try { renderMessages(); }
    catch (e) {
      const box = $('messages');
      if (box) box.appendChild(buildMessageEl(botMsg, conv));
    }
    const box = $('messages');
    bubble = box?.lastElementChild?.querySelector('.bubble') || null;
    waitEl = bubble?.querySelector('.wait-status') || null;
    if (bubble) {
      try { bubble.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      void bubble.offsetHeight;
    }
    await paintFrame();
    await waitUntilVisible(bubble || box);
    thinkingShownAt = performance.now();

    const query = attachment?.kind === 'text' ? `${text}\n\n【附加檔案：${attachment.filename}】\n${attachment.extractedText}` : text;
    let backtestContext = '';
    try {
      backtestContext = await buildBacktestContext();
    } catch (e) {
      backtestContext = '（回測脈絡暫時無法整理：' + explainError(e && e.message, String(e)) + '。請仍依使用者的問題回答。）';
    }
    let backtestHash = '';
    try { backtestHash = await hashText(backtestContext); } catch (e) { backtestHash = ''; }
    const backtestUnchanged = !!(backtestHash && conv.lastBacktestHash && conv.lastBacktestHash === backtestHash);
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Auth': getAuth() },
      body: JSON.stringify({
        query,
        historySummary: conv.historySummary || '',
        lastAiResponse,
        model: conv.model,
        attachment: attachment?.kind === 'binary' ? attachment : undefined,
        backtestContext: backtestUnchanged ? undefined : backtestContext,
        backtestUnchanged,
        lastComplexity: Number.isFinite(conv.lastComplexity) ? conv.lastComplexity : undefined
      })
    });
    sawHttp = true;
    if (res.status === 401) {
      authFailed = true;
      throw new Error('密碼錯誤或已失效（HTTP 401）');
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      const raw = await res.text().catch(() => '');
      if (raw) {
        try {
          const body = JSON.parse(raw);
          detail = explainError(body.error ?? body.message ?? body, detail);
        } catch (e) {
          detail = raw.slice(0, 300);
        }
        if (!detail.includes(String(res.status))) detail = `${detail}（HTTP ${res.status}）`;
      }
      throw new Error(detail);
    }
    if (!res.body) throw new Error(`Worker 沒有回傳串流內容（HTTP ${res.status}）`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let acc = '';
    let pending = false;
    let lastRender = 0;
    const scheduleRender = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        if (bubble) {
          try { renderMarkdown(bubble, acc); }
          catch (e) { bubble.textContent = acc; }
        }
        if (box) box.scrollTop = box.scrollHeight;
        pending = false;
      });
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data: ') || t === 'data: [DONE]') continue;
        let json;
        try { json = JSON.parse(t.slice(6)); } catch (e) { continue; }
        if (json.error && !json.choices) throw new Error(explainError(json.error, 'Worker 回傳錯誤'));
        if (json.type === 'status' && json.text && !acc) {
          if (!waitEl && bubble) {
            waitEl = el('div', 'wait-status', json.text);
            bubble.appendChild(waitEl);
          } else if (waitEl) waitEl.textContent = json.text;
          continue;
        }
        if (json.type === 'meta') {
          if (json.history_summary) conv.historySummary = json.history_summary;
          if (Number.isFinite(json.complexity)) conv.lastComplexity = json.complexity;
          botMsg.usedModel = json.used_model || conv.model;
          botMsg.complexity = json.complexity;
          botMsg.taskTag = json.task_tag || '';
          botMsg.summarizerRaw = json.raw_summary || '';
          continue;
        }
        const token = json.choices?.[0]?.delta?.content || '';
        if (token) {
          acc += token;
          botMsg.pending = false;
          botMsg.text = acc;
          const now = Date.now();
          if (now - lastRender >= 80) { lastRender = now; scheduleRender(); }
        }
      }
    }
    if (!acc) throw new Error('模型沒有回傳內容');
    botMsg.pending = false;
    botMsg.text = acc;
    conv.lastBacktestHash = backtestHash;
    saveConversations();
    renderMessages();
    try { await maybeAutoApplyControls(botMsg); } catch (e) { console.error(e); }
    if (isFirst) fetchAutoTitle(conv, text, acc);
  } catch (err) {
    await holdThinking(thinkingShownAt);
    const raw = explainError(err && err.message, String(err || '未知錯誤'));
    const fetchThrew = /Failed to fetch|NetworkError|Load failed|network error/i.test(raw);
    let msg = raw;
    if (!sawHttp && fetchThrew) {
      const local = ['localhost', '127.0.0.1'].includes(location.hostname);
      msg = local
        ? '無法連上本機 Worker（127.0.0.1:8787）。請先在專案根目錄執行 npm run dev，或改用 GitHub Pages 線上版。'
        : `無法連上 AI Worker：${raw}`;
    } else if (sawHttp && fetchThrew) {
      msg = `回覆傳到一半中斷了：${raw}`;
    }
    const errorMsg = { role: 'error', text: msg, pending: false, time: Date.now() };
    const idx = conv.messages.lastIndexOf(botMsg);
    if (idx >= 0) conv.messages[idx] = errorMsg;
    else conv.messages.push(errorMsg);
    if (bubble && bubble.isConnected) bubble.textContent = errorMsg.text;
    try { saveConversations(); } catch (e) {}
    try { renderMessages(); } catch (e) {}
    if (authFailed) handleUnauthorized();
  } finally {
    state.isSending = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}
