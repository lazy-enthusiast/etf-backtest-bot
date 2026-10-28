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
