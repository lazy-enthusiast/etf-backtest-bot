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
  // 舊對話若選了已移除的模型（例如 Haiku），改回自動
  let changed = false;
  conversations.forEach(c => {
    if (c.model && !keys.has(c.model)) { c.model = data.default || 'auto'; changed = true; }
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
    model: $('modelSelect').value || 'auto',
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
  container.innerHTML = DOMPurify.sanitize(marked.parse(text));
  container.querySelectorAll('pre code.language-portfolio').forEach(code => {
    const pf = parsePortfolioBlock(code.textContent);
    if (pf) code.parentElement.replaceWith(buildPortfolioCard(pf));
  });
  container.querySelectorAll('pre code.language-plan').forEach(code => {
    const plan = parsePlanBlock(code.textContent);
    if (plan) code.parentElement.replaceWith(buildPlanCard(plan));
  });
  container.querySelectorAll('pre code').forEach(code => {
    const lang = (code.className.match(/language-(\w+)/) || [])[1] || 'code';
    if (!['portfolio', 'plan'].includes(lang) && hljs.getLanguage(lang)) hljs.highlightElement(code);
    const pre = code.parentElement;
    const box = el('div', 'code-box');
    const head = el('div', 'code-head');
    head.appendChild(el('span', '', lang));
    const copy = el('button', '', '複製');
    copy.onclick = () => navigator.clipboard.writeText(code.innerText).then(() => { copy.textContent = '✓ 已複製'; setTimeout(() => { copy.textContent = '複製'; }, 1200); });
    head.appendChild(copy);
    pre.replaceWith(box);
    box.append(head, pre);
  });
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
  if (m.role === 'bot') renderMarkdown(bubble, m.text || '');
  else bubble.textContent = m.text;
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
  box.innerHTML = '';
  const conv = getActiveConv();
  if (!conv) return;
  $('convSelect').value = conv.id;
  if ($('modelSelect').querySelector(`option[value="${conv.model}"]`)) $('modelSelect').value = conv.model;
  updateAdvSettingsSummary();
  if (!conv.messages.length) box.appendChild(welcomeEl());
  conv.messages.forEach(m => box.appendChild(buildMessageEl(m, conv)));
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
    if (conv.messages[i].role === 'bot' && conv.messages[i].text) return conv.messages[i].text;
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

export async function doSend(conv, text, attachment, lastAiResponse, isFirst) {
  const botMsg = { role: 'bot', text: '', time: Date.now() };
  conv.messages.push(botMsg);
  renderMessages();
  const box = $('messages');
  const bubble = box.lastElementChild.querySelector('.bubble');
  bubble.textContent = '思考中…';

  const query = attachment?.kind === 'text' ? `${text}\n\n【附加檔案：${attachment.filename}】\n${attachment.extractedText}` : text;
  state.isSending = true;
  $('sendBtn').disabled = true;
  try {
    const backtestContext = await buildBacktestContext();
    const backtestHash = await hashText(backtestContext);
    const backtestUnchanged = !!(conv.lastBacktestHash && conv.lastBacktestHash === backtestHash);
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
    if (res.status === 401) {
      handleUnauthorized();
      throw new Error('密碼錯誤或已失效');
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch (e) {}
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let acc = '';
    let pending = false;
    let lastRender = 0;
    const scheduleRender = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { renderMarkdown(bubble, acc); box.scrollTop = box.scrollHeight; pending = false; });
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
        try {
          const json = JSON.parse(t.slice(6));
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
            botMsg.text = acc;
            const now = Date.now();
            if (now - lastRender >= 80) { lastRender = now; scheduleRender(); }
          }
        } catch (e) {}
      }
    }
    if (!acc) throw new Error('模型沒有回傳內容');
    botMsg.text = acc;
    conv.lastBacktestHash = backtestHash;
    saveConversations();
    renderMessages();
    await maybeAutoApplyControls(botMsg);
    if (isFirst) fetchAutoTitle(conv, text, acc);
  } catch (err) {
    conv.messages[conv.messages.length - 1] = { role: 'error', text: '連線失敗：' + err.message, time: Date.now() };
    saveConversations();
    renderMessages();
  } finally {
    state.isSending = false;
    $('sendBtn').disabled = false;
  }
}
