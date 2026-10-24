import { WORKER_URL, AUTH_STORAGE_KEY } from './config.js';
import { $ } from './dom.js';

export function getAuth() {
  return localStorage.getItem(AUTH_STORAGE_KEY) || '';
}

export function setShellAriaHidden(hidden) {
  document.querySelectorAll('.appbar, .shell').forEach(node => {
    if (hidden) node.setAttribute('aria-hidden', 'true');
    else node.removeAttribute('aria-hidden');
  });
}

export function authFocusables() {
  const box = document.querySelector('.authBox');
  if (!box) return [];
  return [...box.querySelectorAll('button:not([disabled]), input:not([disabled])')]
    .filter(el => el.offsetParent !== null);
}

export function onAuthKeydown(e) {
  if (!$('authOverlay') || $('authOverlay').hidden) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    // 已登入時開「更換密碼」可取消；未登入則無法關閉
    if (getAuth()) {
      $('authOverlay').hidden = true;
      $('authError').textContent = '';
      unlockApp();
    }
    return;
  }
  if (e.key !== 'Tab') return;
  const nodes = authFocusables();
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function lockApp() {
  document.body.classList.add('locked');
  setShellAriaHidden(true);
  document.addEventListener('keydown', onAuthKeydown, true);
}

export function unlockApp() {
  document.body.classList.remove('locked');
  setShellAriaHidden(false);
  document.removeEventListener('keydown', onAuthKeydown, true);
}

export function showAuthDialog(message) {
  lockApp();
  const hadAuth = !!getAuth();
  $('authTitle').textContent = hadAuth ? '更換存取密碼' : '解鎖退休航道';
  $('authDesc').textContent = hadAuth
    ? '輸入新的存取密碼並向 Worker 驗證。通過後會取代目前瀏覽器中的密碼。'
    : '此為私人工具。請輸入存取密碼後才能使用；密碼只存在這個瀏覽器，不會寫進網頁原始碼。';
  $('authSubmitBtn').textContent = hadAuth ? '更新並解鎖' : '解鎖';
  $('authError').textContent = message || '';
  $('authOverlay').hidden = false;
  const input = $('authInput');
  input.value = '';
  requestAnimationFrame(() => input.focus());
}

export async function submitAuth() {
  const input = $('authInput');
  const errorEl = $('authError');
  const btn = $('authSubmitBtn');
  const password = input.value.trim();
  if (!password) {
    errorEl.textContent = '請輸入存取密碼';
    input.focus();
    return;
  }
  btn.disabled = true;
  errorEl.textContent = '驗證中…';
  try {
    const res = await fetch(`${WORKER_URL}api/auth-check`, { headers: { 'X-App-Auth': password } });
    if (res.status === 401) { errorEl.textContent = '密碼錯誤，請再試一次'; input.select(); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    localStorage.setItem(AUTH_STORAGE_KEY, password);
    $('authOverlay').hidden = true;
    unlockApp();
  } catch (e) {
    errorEl.textContent = '無法連線到 Worker：' + e.message;
  } finally {
    btn.disabled = false;
  }
}

export function handleUnauthorized() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  showAuthDialog('密碼已失效或錯誤，請重新輸入。');
}
