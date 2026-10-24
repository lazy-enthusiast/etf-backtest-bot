import { STORE, REBALANCE_LABELS } from './config.js';
import { state } from './state.js';
import { $, el } from './dom.js';
import { loadJSON } from './storage.js';
import { getAuth, showAuthDialog, submitAuth, unlockApp } from './auth.js';
import { loadMeta, backtestableSymbols, earliestDate } from './data.js';
import { renderPlanForm, writePlanForm } from './plan-form.js';
import { writePortfolioForm, addHoldingRow, onPortfolioEdited } from './portfolio-form.js';
import { recalc, setStatus } from './recalc.js';
import { renderDashboard, renderActiveTab } from './dashboard.js';
import {
  loadModels, newConversation, getActiveConv, renderConvSelect, renderMessages,
  switchConversation, toggleConvMenu, changeModel, sendMessage, handleFileSelect,
  conversations
} from './chat.js';
import * as chat from './chat.js';

export function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem(STORE.theme, document.body.classList.contains('dark') ? 'dark' : 'light');
  renderDashboard();
}

export function toggleAdvisor(force) {
  const open = force ?? !document.body.classList.contains('advisor-open');
  document.body.classList.toggle('advisor-open', open);
}

function initRebalanceSelect() {
  const select = $('rebalance');
  Object.entries(REBALANCE_LABELS).forEach(([value, label]) => {
    const o = el('option', '', label);
    o.value = value;
    select.appendChild(o);
  });
  ['rebalance', 'btStart', 'btEnd'].forEach(id => $(id).addEventListener('change', onPortfolioEdited));
}

function bindUi() {
  $('authKeyBtn')?.addEventListener('click', () => showAuthDialog());
  document.querySelectorAll('.appbar > .icon-btn').forEach(btn => {
    if (btn.title === '切換深色模式') btn.addEventListener('click', () => toggleTheme());
  });
  $('advisorToggle')?.addEventListener('click', () => toggleAdvisor());
  $('advisorClose')?.addEventListener('click', () => toggleAdvisor(false));

  document.querySelectorAll('button.btn').forEach(btn => {
    if (btn.textContent.trim() === '＋ 新增 ETF') {
      btn.addEventListener('click', () => addHoldingRow('', ''));
    }
  });

  $('calcBtn')?.addEventListener('click', () => recalc({ markPrevious: true }));
  $('authSubmitBtn')?.addEventListener('click', () => submitAuth());
  $('authInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });

  $('convSelect')?.addEventListener('change', e => switchConversation(e.target.value));
  document.querySelectorAll('.adv-controls .icon-btn').forEach(btn => {
    if (btn.title === '新對話') btn.addEventListener('click', () => newConversation());
    if (btn.title === '更多') btn.addEventListener('click', e => toggleConvMenu(e));
  });
  $('modelSelect')?.addEventListener('change', () => changeModel());
  $('attachBtn')?.addEventListener('click', () => $('fileInput').click());
  $('fileInput')?.addEventListener('change', handleFileSelect);
  $('sendBtn')?.addEventListener('click', () => sendMessage());

  document.querySelectorAll('#tabs button').forEach(b => {
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      localStorage.setItem(STORE.tab, state.tab);
      renderActiveTab();
    });
  });

  document.addEventListener('click', () => $('convMenu')?.querySelector('.menu')?.remove());

  const inputBox = $('inputBox');
  inputBox?.addEventListener('input', () => {
    inputBox.style.height = 'auto';
    inputBox.style.height = Math.min(inputBox.scrollHeight, 160) + 'px';
  });
  inputBox?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
  });
}

async function init() {
  renderPlanForm();
  initRebalanceSelect();
  const mq = window.matchMedia('(max-width: 1100px)');
  const syncClose = () => { $('advisorClose').style.display = mq.matches ? '' : 'none'; };
  mq.addEventListener('change', syncClose);
  syncClose();

  const meta = await loadMeta().catch(err => { setStatus('載入資料失敗：' + err.message, true); return null; });
  state.plan = meta ? meta.retirement.normalizePlan(loadJSON(STORE.plan, {})) : loadJSON(STORE.plan, {});
  writePlanForm();
  writePortfolioForm(state.portfolio);

  if (meta) {
    backtestableSymbols(meta).forEach(s => {
      const o = el('option');
      o.value = s;
      o.label = `${meta.manifest.symbols[s]?.name || meta.mapping.etfs[s]?.name || ''}（${earliestDate(meta, s).slice(0, 4)} 起）`;
      $('symbolList').appendChild(o);
    });
    recalc({ markPrevious: false });
  }

  await loadModels().catch(err => {
    console.error('載入模型清單失敗:', err);
    const o = el('option', '', '自動（Worker 未連線）');
    o.value = 'auto';
    $('modelSelect').appendChild(o);
  });
  if (!conversations.length || !getActiveConv()) {
    if (!conversations.length) newConversation();
    else chat.activeId = conversations[0].id;
  }
  renderConvSelect();
  renderMessages();
  if (!getAuth()) showAuthDialog();
  else unlockApp();
}

bindUi();
init();
