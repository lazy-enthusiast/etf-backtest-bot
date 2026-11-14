// 手機鍵盤會縮小 visual viewport，有時還會把畫面往上推。
// 推完沒收乾淨時，height:100% 加上 body overflow:hidden 會在下半部留下空白。
// 只在鍵盤真的打開或畫面被推移時才改高度；收起後清掉，避免空白留著。

export function visualViewportFrame(layoutHeight, visual, mobile) {
  if (!mobile || !visual) return null;
  const height = Number(visual.height);
  const offset = Number(visual.offsetTop) || 0;
  if (!Number.isFinite(height) || height <= 0) return null;
  if (offset <= 0.5 && height >= layoutHeight - 1) return null;
  return {
    height: Math.round(height),
    offset: Math.max(0, Math.round(offset))
  };
}

let synced = false;

export function applyVisualViewportFrame(frame) {
  const root = document.documentElement;
  if (!frame) {
    if (!synced) return;
    synced = false;
    root.classList.remove('vv-sync');
    root.style.removeProperty('--app-height');
    root.style.removeProperty('--app-offset');
    const scroller = document.scrollingElement;
    if (scroller && scroller.scrollTop) scroller.scrollTop = 0;
    return;
  }
  synced = true;
  root.classList.add('vv-sync');
  root.style.setProperty('--app-height', `${frame.height}px`);
  root.style.setProperty('--app-offset', `${frame.offset}px`);
}

export function currentVisualViewportFrame() {
  const mobile = window.matchMedia('(max-width: 1100px)').matches;
  const vv = window.visualViewport;
  const visual = vv ? { height: vv.height, offsetTop: vv.offsetTop } : null;
  return visualViewportFrame(window.innerHeight, visual, mobile);
}

export function bindVisualViewport() {
  const apply = () => applyVisualViewportFrame(currentVisualViewportFrame());
  apply();
  window.visualViewport?.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('scroll', apply);
  window.addEventListener('resize', apply);
  document.addEventListener('focusin', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest('.dash-scroll')) return;
    if (!window.matchMedia('(max-width: 1100px)').matches) return;
    requestAnimationFrame(() => {
      const row = target.closest('.field') || target;
      row.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  });
}
