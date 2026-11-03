import { effectiveSampleNote, fxStressAmounts, spendingCurveNote } from '../backtest/retirement.js';

function side(name, row, fmt) {
  return `${name}成功率 ${fmt.pct(row.successRate, 0)}、期末中位 ${fmt.money(row.endBalanceP50)}、最差最低年支出 ${fmt.money(row.worstMinSpend)}`;
}

/** 儀表板與顧問敘述共用這些句子。金額格式由呼叫端決定。 */
export function highlightLines(sim, plan, fmt, extras = {}) {
  const lines = {};
  const g = sim?.glide;
  if (g?.skipped || (g && !Number.isFinite(g.min))) {
    lines.glide = '下滑路徑未套用：需要同時標示股票代號與其他持倉，且價格月序對得上。';
  } else if (g && Number.isFinite(g.min)) {
    let text = `實際股權重 ${fmt.pct(g.min, 0)}–${fmt.pct(g.max, 0)}（同一條歷史索引，只改該月目標權重）`;
    if (sim.glideCompare) {
      const cmp = sim.glideCompare;
      text += `。${cmp.label}。${side('固定權重', cmp.flat, fmt)}；${side('下滑', cmp.glide, fmt)}`;
    }
    lines.glide = text;
  }

  const drag = sim?.taxDrag;
  if (drag) {
    const pre = extras.cagr;
    const tail = Number.isFinite(pre)
      ? `，稅後 CAGR ${fmt.pct(pre - drag.annual, 2)}（稅前 ${fmt.pct(pre, 2)}）`
      : '';
    lines.tax = `估計：年化稅負拖累 ${(drag.annual * 100).toFixed(2)}%${tail}`;
  }

  if (plan?.dividendTax) {
    const cmp = sim?.dividendSpend;
    lines.dividend = cmp
      ? `股息稅：中位實際提出 ${fmt.money(cmp.withTax)}，未扣稅 ${fmt.money(cmp.withoutTax)}。可持續支出分位仍是未另扣這筆稅的固定實質口徑。`
      : '股息稅未套用：沒有對得上持倉的假設殖利率與註冊地稅率。';
  }

  const curve = sim?.curveCompare;
  if (curve) {
    lines.curve = `${curve.label}：${curve.note}。${side('固定', curve.flat, fmt)}；${side('此曲線', curve.shaped, fmt)}`;
  }

  const cash = sim?.cashCompare;
  if (cash) {
    lines.cash = `${cash.label}：現金桶規則。最差路徑最低年提領 之前 ${fmt.money(cash.before)}、之後 ${fmt.money(cash.after)}`;
  }

  if (plan?.feeSplit) {
    const cmp = sim?.feeSpend;
    lines.fee = cmp
      ? `費用拆分：中位實際提出 ${fmt.money(cmp.withSplit)}，未拆分（仍用單一費用率） ${fmt.money(cmp.withoutSplit)}`
      : '費用拆分已取代單一費用率。與未拆分的支出對照只在未同時開啟下滑路徑時計算。';
  }

  if (plan?.fxMode) {
    if (sim?.fxStatus?.skipped === 'twd') {
      lines.fx = '台幣在支出籃裡，但沒有傳入匯率序列，所以這次沒有換算，也沒有拿港幣聯繫來充數。';
    } else if (sim?.fxSpend) {
      const peg = sim.fxStatus?.twd
        ? '台幣用傳入的匯率序列。'
        : '港幣部分用 7.8 聯繫匯率假設，匯率不變時支出數字與未換算相同。';
      lines.fx = `匯率：中位實際提出 ${fmt.money(sim.fxSpend.withFx)}，未換算 ${fmt.money(sim.fxSpend.withoutFx)}。${peg}`;
    } else lines.fx = '支出匯率未套用。';
  }

  const stress = fxStressAmounts(sim?.sustainableSpending?.p95);
  if (stress) {
    lines.fxStress = [
      '估計：港幣與美元掛鉤，這是壓力測試，不是預測。',
      `若美元兌港幣下跌 10%，實質可花 ${fmt.money(stress.down10)}。`,
      `若美元兌港幣下跌 20%，實質可花 ${fmt.money(stress.down20)}。`
    ].join('\n');
  }

  const boot = sim?.bootstrapCompare;
  if (boot) {
    const tag = boot.robust ? '，穩健' : '';
    lines.bootstrap = `估計：歷史成功率 ${fmt.pct(boot.historical, 1)}，拔靴成功率 ${fmt.pct(boot.bootstrap, 1)}${tag}`;
  }
  if (plan?.pathMode === 'bootstrap') {
    lines.bootstrapMode = `拔靴：${plan.bootstrapBlock} 個月區塊，種子 ${plan.bootstrapSeed}`;
  }
  if (plan && (plan.withdrawEvery !== 1 || plan.guardrailEvery !== 12)) {
    lines.frequency = `提領每 ${plan.withdrawEvery} 個月，護欄每 ${plan.guardrailEvery} 個月檢查`;
  }
  if (sim?.history) {
    lines.sample = effectiveSampleNote(sim.history, {
      pathMode: plan?.pathMode,
      bootstrapBlock: plan?.bootstrapBlock,
      successRate: sim.successRate
    });
  }
  return lines;
}

export function planOptionLines(plan) {
  if (!plan) return [];
  const lines = [];
  if (plan.cashBucketYears) {
    lines.push(`現金桶：${plan.cashBucketYears} 年。股價當年跌超過 10% 時支出從現金桶付。概念建議，不取代成功率。`);
  }
  if (plan.spendingCurve === 'declining' || plan.spendingCurve === 'u_shape') {
    lines.push(`支出曲線：${spendingCurveNote(plan.spendingCurve)}。只跟固定結果並列，不取代成功率。`);
  }
  if (plan.lumpSums?.length) lines.push(`一次性支出 ${plan.lumpSums.length} 筆。`);
  if (plan.otherIncomeSegments?.length) lines.push(`分段其他收入 ${plan.otherIncomeSegments.length} 段。`);
  if (plan.compareBootstrap) lines.push('拔靴對照：開。歷史成功率仍是公布的成功率。');
  return lines;
}

/** 概況上的資料限制。不放進成功率圓環。 */
export function overviewNotes({ result, sim, plan }) {
  const notes = [];
  if (result?.account?.note) notes.push(result.account.note);
  if (plan?.currency && plan.currency !== 'HKD') {
    notes.push(`金額標成 ${plan.currency}，但價格是用港元算的。`);
  }
  if (plan?.inflationMode !== 'fixed') notes.push('通膨用的是美國物價，不是香港物價。');
  if ((result?.warnings || []).some(w => w.includes('價格指數') || w.includes('不含股息'))) {
    notes.push('有些較早的資料不含派息，數字會偏低。港股特別明顯。');
  }
  if (sim?.history?.method === 'circular') {
    notes.push('歷史長度不足整個計劃年限，退休模擬以循環序列補足。');
  }
  return notes;
}

/** 進階區文案。結果叫「重排後達成比例」，不叫機率或勝率。 */
export function reshuffleParts(mc, { priceIndex = false, legacyOn = false } = {}) {
  if (!mc) return { headline: '尚未計算。', spend: '', notes: '' };
  const blockLine = Number.isFinite(mc.historyMonths)
    ? `這段歷史有 ${mc.historyMonths} 個月。大約能切出 ${mc.nonOverlappingBlocks ?? '—'} 段不重複的月份。`
    : '';
  const capLine = mc.capped ? `你填的月數太長，已改成 ${mc.blockMonths} 個月。` : '';
  const fewLine = mc.fewBlocks && !mc.suppressed ? '能切出的整段不多。換個種子，數字會跳很多。' : '';
  const noise = '換一個種子，這個比例會上下動一點。';
  const price = priceIndex ? '有些較早的資料不含派息，港股會顯得比較保守。重排也會跟著保守。' : '';
  const legacy = legacyOn ? '你已開啟「區塊拔靴」，其數字與這裡不能直接比較。' : '';
  const notes = [blockLine, capLine, fewLine, noise, price, legacy].filter(Boolean).join('');
  if (mc.suppressed) {
    return {
      headline: `${mc.suppressed}。上面圓環的數字不會因此改變。`,
      spend: '',
      notes
    };
  }
  const pctText = `${Math.round(mc.solventRate * 1000) / 10}%`;
  const ruin = mc.ruinAge
    ? `沒撐到的那些，最早 ${mc.ruinAge.min.toFixed(1)} 歲用完，中間是 ${mc.ruinAge.p50.toFixed(1)} 歲。`
    : '';
  const amount = mc.sustainableSpending;
  const p10 = amount ? Math.round(amount.p10).toLocaleString('en-US') : '';
  const p50 = amount ? Math.round(amount.p50).toLocaleString('en-US') : '';
  const spendBits = amount ? `P10 ${p10}、P50 ${p50}，與概況裡的歷史可花金額不是同一回事。` : '';
  const spend = amount
    ? `這不是概況裡的歷史可花金額。這裡的意思是：以今天的購買力計，每年花同樣金額，剛好在計劃結束時用完。P10 ${p10} 為較保守的情況，約十次模擬中有一次，可花金額會低於這個數字。P50 ${p50} 為中間值，約一半的模擬高於它、一半低於它。`
    : '';
  return {
    headline: `重排後達成比例為 ${pctText}。意思是：把歷史月份打亂重排後，有 ${pctText} 的模擬能讓錢用到計劃結束。這不是預測。${spendBits}${ruin}共模擬 ${mc.paths} 次，每段 ${mc.blockMonths} 個月；隨機種子 ${mc.seed}（相同種子可重現相同結果）。`,
    spend,
    notes
  };
}
