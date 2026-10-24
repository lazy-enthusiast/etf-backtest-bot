// 動態脈絡預算：骨架化上一輪、摘要跳過判斷、Mem0 是否值得打

const CONTINUE_RE = /^(繼續|請繼續|接著|往下|再說|好的?|嗯+|ok|okay|yes|繼續分析|請接著)[\s。.!！？?]*$/i;
const MEM0_RE = /偏好|風險承受|風險胃納|稅|遺產|香港|台灣|居住|後代|家人|健康|不要買|排除|討厭|必須|長期|記住|我是|我住|港幣|美金|美元|HKD|USD/;
const HEAVY_RE = /比較|對照|多方案|從零|設計|配置|提領|護欄|VPW|下滑|稅務|幣別|槓桿|蒙地|bootstrap|遺產/;

const MAX_SKELETON_CHARS = 1800;

/** 上一輪完整回覆 → 給回答模型／摘要用的骨架（結論＋表格摘要＋未決點）。 */
export function skeletonizeLastReply(text) {
  if (!text || typeof text !== 'string') return '（無）';
  const raw = text.trim();
  if (!raw) return '（無）';
  if (raw.length <= 600) return raw;

  const lines = raw.split(/\r?\n/);
  const keep = [];
  let inCode = false;
  let codeBuf = [];
  let bullets = 0;

  const push = (s) => {
    if (s != null && String(s).trim()) keep.push(String(s).trim());
  };

  // 首段非空（通常是結論）
  for (const line of lines) {
    if (line.trim()) {
      push(line);
      break;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeBuf = [t];
      } else {
        codeBuf.push(t);
        push(codeBuf.join('\n'));
        inCode = false;
        codeBuf = [];
      }
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    if (/^#{1,3}\s/.test(t) || /^[-*]\s/.test(t) || /^\d+\.\s/.test(t)) {
      if (bullets < 12) {
        push(t);
        bullets++;
      }
      continue;
    }
    if (t.includes('|') && t.length < 200) push(t);
    if (/未決|尚待|下一步|建議先|風險|注意|對照固定/.test(t) && t.length < 180) push(t);
  }

  let out = [...new Set(keep)].join('\n');
  if (out.length < 200) {
    // 骨架太瘦：退回開頭 + 結尾各一段
    out = raw.slice(0, 900) + (raw.length > 900 ? '\n…\n' + raw.slice(-600) : '');
  }
  if (out.length > MAX_SKELETON_CHARS) {
    out = out.slice(0, MAX_SKELETON_CHARS) + '\n…（上一輪已骨架化）';
  }
  return out;
}

export function shouldSkipSummarizer({ query, historySummary, backtestUnchanged, hasAttachment }) {
  if (hasAttachment) return false;
  if (!historySummary || historySummary.length < 80) return false;
  if (!backtestUnchanged) return false;
  const q = String(query || '').trim();
  if (!q) return false;
  if (CONTINUE_RE.test(q)) return true;
  if (q.length <= 48 && !HEAVY_RE.test(q) && !MEM0_RE.test(q)) return true;
  return false;
}

export function estimateComplexity(query, fallback = 5) {
  const q = String(query || '');
  if (HEAVY_RE.test(q) || q.length > 400) return Math.max(fallback, 8);
  if (q.length > 120 || /調整|權重|支出|退休年齡|成功率/.test(q)) return Math.max(fallback, 5);
  if (CONTINUE_RE.test(q.trim()) || q.length < 40) return Math.min(fallback, 4);
  return fallback;
}

export function shouldSearchMem0(query, { backtestUnchanged, skipSummarizer } = {}) {
  const q = String(query || '');
  if (MEM0_RE.test(q)) return true;
  if (!q.trim()) return false;
  // 短續問且回測沒變：長期記憶幾乎用不到
  if (backtestUnchanged && skipSummarizer) return false;
  if (backtestUnchanged && q.length < 60 && !HEAVY_RE.test(q)) return false;
  return true;
}
