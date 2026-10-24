// 用法：node backtest/cli.js "SPY:60,TLT:40" [--rebalance annual] [--start 1990-01-01] [--end 2020-12-31] [--initial 10000] [--json]

import { runBacktest, symbolsNeeded } from './engine.js';
import { ensureData, loadMapping } from './data-fetcher.js';

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opts.json = true;
    else if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { opts, spec: positional.join(',') };
}

function parseHoldings(spec) {
  const holdings = {};
  for (const part of spec.split(',').map(s => s.trim()).filter(Boolean)) {
    const [symbol, weight] = part.split(':');
    holdings[symbol.toUpperCase()] = weight === undefined ? 1 : Number(weight);
  }
  return holdings;
}

const pct = x => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(2)}%`);
const num = x => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(2));

function printReport(r) {
  const { stats, period } = r;
  console.log(`\n組合：${r.portfolio.holdings.map(h => `${h.symbol} ${pct(h.weight)}`).join(' / ')}，再平衡：${r.portfolio.rebalance}`);
  console.log(`期間：${period.start} ~ ${period.end}（${period.years.toFixed(1)} 年，起點受 ${period.limitingAsset} 限制）`);
  console.log(`期末：${r.finalValue.toFixed(0)}（初始 ${r.portfolio.initial}）`);
  console.log(`CAGR ${pct(stats.cagr)}  波動 ${pct(stats.volatility)}  Sharpe(rf=${pct(r.portfolio.riskFreeRate)}) ${num(stats.sharpe)}  Sortino ${num(stats.sortino)}  Calmar ${num(stats.calmar)}`);
  console.log(`最大回撤 ${pct(stats.maxDrawdown)}（${stats.peakDate} → ${stats.troughDate}，回復：${stats.recoveryDate || '尚未回復'}）`);

  const full = r.annualReturns.filter(y => !y.partial);
  if (full.length) {
    const best = full.reduce((a, b) => (b.return > a.return ? b : a));
    const worst = full.reduce((a, b) => (b.return < a.return ? b : a));
    console.log(`最佳年 ${best.year} ${pct(best.return)}，最差年 ${worst.year} ${pct(worst.return)}`);
  }

  console.log('\n個別資產（同一區間）：');
  for (const a of r.assets) {
    const src = a.dataSources.map(s => `${s.symbol}(${s.from.slice(0, 4)}~)`).join(' ← ');
    console.log(`  ${a.symbol.padEnd(8)} CAGR ${pct(a.cagr).padStart(7)}  波動 ${pct(a.volatility).padStart(7)}  MDD ${pct(a.maxDrawdown).padStart(8)}  資料：${src}`);
  }

  if (r.warnings.length) {
    console.log('\n注意：');
    for (const w of r.warnings) console.log(`  - ${w}`);
  }
}

async function main() {
  const { opts, spec } = parseArgs(process.argv.slice(2));
  if (!spec) {
    console.log('用法：node backtest/cli.js "SPY:60,TLT:40" [--rebalance annual] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--json]');
    return;
  }
  const holdings = parseHoldings(spec);
  const mapping = await loadMapping();
  const data = await ensureData(symbolsNeeded(Object.keys(holdings), mapping));
  const result = runBacktest({
    holdings,
    rebalance: opts.rebalance,
    start: opts.start,
    end: opts.end,
    initial: opts.initial ? Number(opts.initial) : undefined
  }, mapping, data);

  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else printReport(result);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
