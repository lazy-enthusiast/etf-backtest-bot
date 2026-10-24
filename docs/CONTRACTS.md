# etf-backtest-bot 系統架構

個人用 ETF 退休規劃工具（「退休航道」）：設定退休計劃與 ETF 組合，在瀏覽器以歷史價格回測並模擬每個起始月份的累積／提領結果；AI 讀取結果、提出改良組合或計劃調整，使用者一鍵套用並重算。

前端是靜態 HTML（GitHub Pages），回測與退休模擬在瀏覽器執行。`data/` 只放長歷史合成序列與 CPI；一般 ETF／基金經 Worker `GET /api/series` 向 Yahoo 即時抓價。AI 對話經 Cloudflare Worker → Vercel Proxy → OpenRouter。

三層（前端／Worker／Proxy）各有存在理由，不要合併。改請求／回應 shape 時，同步檢查 `js/`（尤其 chat／context／ai-controls）、Worker、Proxy。所有金鑰走環境變數，不要硬編碼。

**文件**
| 檔案 | 用途 |
|---|---|
| [CONTRACTS.md](./CONTRACTS.md)（本檔） | 現行架構、API／資料契約、操作 |
| [WORK_LOG.md](./WORK_LOG.md) | 精簡開發時間線（為何變成現在這樣） |

---

## 系統架構總覽

```
瀏覽器 (GitHub Pages)
  index.html + styles/app.css + js/app.js
      │  import
      ├──────────────────►  backtest/engine.js、backtest/retirement.js
      │  fetch（同源：合成／CPI）
      ├──────────────────►  backtest/index-mapping.json、data/manifest.json、data/{SYNTHETIC,CPI}.json
      │  X-App-Auth GET /api/series?symbol=
      ├──────────────────►  Worker ──► Yahoo Chart API（Cache API 24h）
      │
      │  X-App-Auth（對話）
      v
Cloudflare Worker（etf-backtest-worker）
  worker/src/index.js  ←  cors / auth / yahoo / mem0 / openrouter / brain
      │  X-Proxy-Secret
      v
Vercel Proxy
  proxy/api/chat.js
      │  Authorization: Bearer <OPENROUTER_API_KEY>
      v
OpenRouter  →  Claude / 其他模型

本機（開發者電腦）
  backtest/data-fetcher.js ──► 更新合成／CPI（或離線快取）──► data/
  npm run dev ──► 靜態前端 :5173 + wrangler dev :8787
```

一輪對話：

1. 前端啟動時 `GET /api/models`（不帶密碼）填模型選單；若 localStorage 沒有密碼，顯示登入框，以 `GET /api/auth-check` 驗證後存入。
2. 使用者編輯計劃／組合後重算：`runBacktest` → `realMonthlyReturns` → `simulateRetirement`，結果顯示於儀表板。
3. 送出時 `POST /`，帶 `X-App-Auth` 與 JSON（query、historySummary、lastAiResponse、model、可選 attachment、backtestContext／backtestUnchanged、lastComplexity）。
4. Worker：上一輪回覆先骨架化；回測未變可跳過重送；短續問可跳過摘要；否則差分摘要。Mem0 僅在相關時搜尋（Cache API 約 10 分鐘）。
5. 依 `complexity` 或使用者指定的 key 選模型，組 system（退休規劃師 prompt + 精簡動態脈絡），經 Proxy 向 OpenRouter 串流。
6. SSE 第一個 event 是 `type: "meta"`；其後是 OpenRouter token。前端把 `history_summary`、`lastComplexity`、回測 hash 寫回 localStorage。
7. 前端把回覆中的 ` ```portfolio `／` ```plan ` 區塊渲染成卡片；套用後重算，並可自動送出摘要訊息讓 AI 繼續分析。

---

## 目錄結構

| 路徑 | 用途 |
|---|---|
| `index.html` | 前端標記（GitHub Pages）；連結 CSS／JS modules |
| `styles/app.css` | 前端樣式 |
| `js/` | 前端 ES modules（config、auth、storage、data、forms、recalc、dashboard、context、ai-controls、chat、app） |
| `.nojekyll` | 讓 GitHub Pages 原樣提供檔案 |
| `backtest/engine.js` | 組合回測核心。純計算、無 I/O |
| `backtest/retirement.js` | 退休模擬（實質報酬、歷史起始月、SWR／PWR）。純計算、無 I/O |
| `backtest/data-fetcher.js` | 薄 facade：`ensureData` + CLI（`npm run fetch`） |
| `backtest/fetch/` | `yahoo.js`、`synthetic.js`、`cache.js` |
| `backtest/index-mapping.json` | ETF → 延伸歷史用的替代序列 |
| `backtest/cli.js` | 終端機回測；`--withdraw` 做提領測試 |
| `data/` | 僅 SYNTHETIC／CPI 與瘦身 `manifest.json`；一般 ETF 不提交 |
| `docs/CONTRACTS.md` | 系統契約（本檔） |
| `docs/WORK_LOG.md` | 開發過程精簡紀錄 |
| `scripts/dev.js` | 本機一鍵啟動前端 + Worker（服務 index／styles／js／backtest／data） |
| `worker/src/index.js` | 薄路由（含 `/api/series`）、SSE、組請求 |
| `worker/src/context-budget.js` | 上一輪骨架化、摘要跳過、Mem0 是否搜尋 |
| `worker/src/yahoo.js` | Yahoo 代抓，回傳與 `data/*.json` 同 shape |
| `worker/src/cors.js`／`auth.js`／`mem0.js`／`openrouter.js` | CORS、驗證、Mem0、Proxy 呼叫 |
| `worker/src/brain.js` | 退休規劃師 prompt、摘要 prompt、模型清單、`pickModelKey` |
| `worker/wrangler.toml` | Worker 名稱（`etf-backtest-worker`）、公開 vars（含 `PROXY_URL`…`/api/chat`） |
| `proxy/api/chat.js` | Vercel Edge Function：驗證後原樣轉發 OpenRouter |
| `package.json` | `npm run dev`／`fetch`／`fetch:all`／`backtest` |

---

## 回測引擎（`backtest/engine.js`）

### 價格資料格式（本地 `data/` 或 Worker `/api/series`）

```json
{
  "symbol": "SPY", "name": "...", "currency": "USD", "instrumentType": "ETF",
  "adjusted": true, "source": "yahoo", "fetchedAt": "ISO 時間",
  "firstDate": "1993-01-29", "lastDate": "2026-10-23",
  "series": [["1993-01-29", 24.4], ...]
}
```

- 本地 `data/` 只放 `instrumentType` 為 `SYNTHETIC`／`CPI` 的長歷史序列；其餘由前端呼叫 `GET /api/series?symbol=`（需 `X-App-Auth`）向 Yahoo 抓 adj close。
- 檔名由 `symbolToFile()` 產生（僅本地檔）：`^GSPC` → `IDX_GSPC.json`。
- `data/manifest.json`：只列本地合成／CPI；前端成功遠端載入後會把 meta 寫進記憶體 manifest。
- 特殊序列：`CPI_US`（通膨）、`US_STOCK_TR`／`US_10Y_TR`（長歷史合成總報酬）等。

### 延伸歷史（`index-mapping.json`）

```json
{ "etfs": { "SPY": { "name": "...", "index": "S&P 500", "proxies": [
  { "symbol": "VFINX", "type": "mutual_fund", "note": "..." },
  { "symbol": "US_STOCK_TR", "type": "synthetic", "note": "..." },
  { "symbol": "^GSPC", "type": "price_index", "note": "..." }
]}}}
```

- 先用 ETF 自身價格；ETF 上市前依 `proxies` 順序往前拼接（報酬率銜接）。
- `type`：`mutual_fund`、`etf`、`total_return_index`、`price_index`（不含股息）、`futures`、`synthetic`（月度合成，波動被低估）。

### `runBacktest(portfolio, mapping, dataBySymbol)`

輸入 `portfolio`：`holdings`（自動正規化）、`rebalance`（`none | monthly | quarterly | semiannual | annual`）、可選 `start`／`end`、`initial`（預設 10000）、`riskFreeRate`（預設 0）。

- 區間：所有資產（含延伸）共同可用的最長區間，再套 `start`／`end`。
- 日期：各資產日期的**聯集**，每個資產取「該日或之前最後一個價格」（可混用日線與月度、不同交易所）。
- 波動／Sharpe／Sortino 用**月報酬**年化；回撤用完整序列。

輸出關鍵欄位：`portfolio`、`period`、`finalValue`、`stats`、`annualReturns`、`assets`、`correlation`、`equityMonthly`、`warnings`。

---

## 退休模擬（`backtest/retirement.js`）

### 計劃參數（`normalizePlan`）

| 欄位 | 說明 |
|---|---|
| `currentAge`／`retireAge`／`endAge` | 歲 |
| `currentSavings` | 現有投資資產（今日幣值） |
| `monthlyContribution` | 退休前每月投入 |
| `annualSpending` | 退休後目標年支出（今日幣值；固定實質＝實際提領，護欄／VPW＝基準） |
| `withdrawalStrategy` | `fixed_real`｜`guardrails`｜`vpw` |
| `guardrailCeiling`／`guardrailFloor`／`guardrailAdjustPct` | 護欄法參數（%）；僅 `guardrails` 使用 |
| `otherIncome`／`otherIncomeAge` | 其他收入與起始年齡 |
| `inflationMode` | `cpi`（美國 CPI）或 `fixed` |
| `inflationRate` | 固定通膨 %／年；cpi 缺月時後備 |
| `feeRate` | 費用＋成本 %／年 |
| `currency` | 顯示用幣別（不做換匯） |

### `simulateRetirement(plan, returns)`

- 以歷史**每個起始月份**模擬整段計劃（累積期 + 提領期）；歷史不足時用循環序列並標示 `method: "circular"`。
- 全部以今日幣值（實質）計算：名目月報酬扣費用後再除通膨。
- 提領規則：`fixed_real` 每年固定；`guardrails` 每年依提領率相對上下限調整支出；`vpw` 每月提領＝剩餘資產÷剩餘月數。
- 輸出含：`successRate`、`successRateFixedReal`（彈性規則時對照）、`spendingFlexibility`（實際／目標提領比與達標月份占比）、`endBalance`、`balanceAtRetire`、`initialWithdrawalRate`、`sustainableSpending`（始終為固定實質口徑）、`withdrawalRates`（SWR／PWR）、`worstRuns`、`bands`、`byStartYear`、`history`。

---

## 已知限制

- 價格指數不含股息；`synthetic` 月度合成會平滑波動與回撤。
- 不做匯率換算，各資產以自身幣別計算。
- Sharpe／Sortino 預設 rf=0。
- 共同基金替代序列已扣基金費用，與 ETF 費用率不同。
- 計劃年限長於可用歷史時用循環序列，結果較不可靠（必須警告）。
- CPI 缺月以固定通膨替代；非美國居民使用美國 CPI 有偏差。

---

## 各層職責

### 前端（`index.html` + `js/`）

- `WORKER_URL`（`js/config.js`）：本機（`localhost`／`127.0.0.1`）→ `http://127.0.0.1:8787/`；否則 → `https://etf-backtest-worker.davchan-clp.workers.dev/`。
- 存取密碼：不寫在原始碼。首次使用或 401 時顯示登入框，`GET /api/auth-check` 後存 `localStorage appAuth`。
- 每則訊息附 `backtestContext`（計劃、退休模擬、組合績效、上一版精簡結果）；前端以 SHA-256 指紋偵測未變時改送 `backtestUnchanged: true` 且省略全文。
- ` ```portfolio ` → `js/ai-controls.js` `parsePortfolioBlock()`；` ```plan ` → `parsePlanBlock()`。單組建議自動寫入左側並重算；多組則顯示卡片供挑選。
- 模型選單來自 `GET /api/models`：自動／DeepSeek V4.1 Flash／Sonnet 5／Opus 5。自動分流：complexity ≤4 → DeepSeek，≤7 → Sonnet，其餘 → Opus。
- 直接 `import` `backtest/engine.js`、`retirement.js`（無 `window.RP_MODULES`）。

### `worker/src/index.js`（+ cors／auth／mem0／openrouter）

- CORS：`ALLOWED_ORIGIN` 可為逗號分隔清單；請求 `Origin` 在清單內才回傳該來源。
- `GET /api/models` 公開；`GET /api/auth-check` 驗證密碼。
- `backtestContext` 截斷至 12000 字；`backtestUnchanged` 時不重送全文。摘要只收增量＋上一輪骨架（見 `context-budget.js`）。
- 短續問且回測未變可跳過摘要；Mem0 可跳過或走 Cache API。
- 不持有 `OPENROUTER_API_KEY`；打 Proxy 時帶 `X-Proxy-Secret`。`PROXY_URL` 須含 `/api/chat`。

### `worker/src/brain.js`

- `SHARED_CORE_SYSTEM`：退休規劃師角色、分析守則、`portfolio`／`plan` 輸出格式。
- `SUMMARIZER_SYSTEM`：只輸出 `{ history_summary, complexity, task_tag }`。
- 動 token 預算、摘要觸發、模型選擇前先問專案負責人。

### `proxy/api/chat.js`

- Vercel Edge。驗證 `x-proxy-secret`，注入 OpenRouter key。可與 deep-water 共用同一個部署。

---

## 環境變數與 Secret

**不要把實際值寫進 repo 或本文件。** `wrangler.toml` `[vars]` 只放非機密公開值；本機開發用 `worker/.dev.vars`（已 gitignore）。

### Cloudflare Worker

| 變數 | 用途 |
|---|---|
| `NAME` | 前端存取密碼（名稱易誤導，它是密鑰） |
| `PROXY_URL` | Vercel Proxy URL（含 `/api/chat`） |
| `PROXY_SECRET` | 打 Proxy 的 `X-Proxy-Secret` |
| `MEM0_API_KEY` | Mem0 API |
| `MEM0_USER_ID` | Mem0 使用者 ID；與 deep-water 分開 |
| `ALLOWED_ORIGIN` | CORS 允許來源（可逗號分隔） |
| `MY_BUCKET` | R2 binding（可選） |

### Vercel Proxy

| 變數 | 用途 |
|---|---|
| `PROXY_SECRET` | 必須與 Worker 的 `PROXY_SECRET` 相同 |
| `OPENROUTER_API_KEY` | 全系統唯一持有 OpenRouter key 的地方 |

---

## API 端點（Worker）

### `GET /api/models`

不驗證。`{ "models": [{ "key", "label", "description" }], "default": "auto" }`。

### `GET /api/auth-check`

需 `X-App-Auth`。正確 → `200 { "ok": true }`；錯誤 → `401 { "ok": false }`。

### `POST /upload`

需 `X-App-Auth`。`multipart/form-data`，欄位 `file`。

### `POST /`

需 `X-App-Auth`、`Content-Type: application/json`。

**一般對話** body：`query`、`historySummary`、`lastAiResponse`、`model`、可選 `attachment`、可選 `backtestContext`、`backtestUnchanged`、`lastComplexity`。回應 `text/event-stream`：

1. `data: {"type":"meta","history_summary","complexity","task_tag","raw_summary","used_model"}`
2. 其後 OpenRouter SSE
3. Header `X-Used-Model` 為實際 key

**產生標題**：body 加 `"action": "generateTitle"`。

---

## ` ```portfolio ` 區塊

```portfolio
{"name": "簡短名稱", "holdings": {"VTI": 50, "IEF": 30, "GLD": 20}, "rebalance": "annual"}
```

- 只含一個 JSON；`rebalance` 為 `none | monthly | quarterly | semiannual | annual`；可選 `start`／`end`。
- 定義在 `brain.js`，解析在 `parsePortfolioBlock()`。

## ` ```plan ` 區塊

```plan
{"note": "改用護欄提領並略降目標支出", "retireAge": 62, "annualSpending": 280000, "withdrawalStrategy": "guardrails"}
```

- 只列要改的欄位；金額為今日幣值。
- 可選 `withdrawalStrategy`：`fixed_real`｜`guardrails`｜`vpw`。
- 定義在 `brain.js`，解析在 `parsePlanBlock()`。
- 一則回覆合計最多 3 個 portfolio／plan 區塊。

---

## 常用操作

```bash
npm run dev                           # 本機前端 + Worker
npm run fetch -- US_STOCK_TR CPI_US   # 更新合成／CPI（其餘 ETF 改由 Worker 即時抓）
npm run fetch:all                     # 含對照表代號的本機快取（可選，離線用）
npm run backtest -- "SPY:60,TLT:40" --rebalance annual
npm run backtest -- "VTI:60,IEF:40" --withdraw 4 --years 30
```

線上前端的 ETF 價格走 Worker Yahoo；只有改了合成／CPI 才需 commit `data/` 並 push。

部署 Worker：`cd worker && npx wrangler deploy`（secrets 用 `wrangler secret put`，勿寫進 git）。

## 如何新增模型

只改 `worker/src/brain.js` 的 `MODEL_CONFIG`（必要時一併改 `DEFAULT_MODEL_KEY`、`pickModelKey`）。前端下次載入會從 `GET /api/models` 同步選單。

## 相關文件

- 開發過程精簡時間線：[WORK_LOG.md](./WORK_LOG.md)
