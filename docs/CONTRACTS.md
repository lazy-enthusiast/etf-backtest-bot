# etf-backtest-bot 系統架構

個人用 ETF 退休規劃工具（「退休航道」）：設定退休計劃與 ETF 組合，在瀏覽器以歷史價格回測並模擬每個起始月份的累積／提領結果；AI 讀取結果、提出改良組合或計劃調整，使用者一鍵套用並重算。

前端是靜態 HTML（GitHub Pages），回測與退休模擬在瀏覽器執行。`data/` 只放長歷史合成序列與 CPI；一般 ETF／基金經 Worker `GET /api/series` 向 Yahoo 即時抓價。AI 對話經 Cloudflare Worker → Vercel Proxy → OpenRouter。

三層（前端／Worker／Proxy）各有存在理由，不要合併。改請求／回應 shape 時，同步檢查 `js/`（尤其 chat／context／ai-controls）、Worker、Proxy。所有金鑰走環境變數，不要硬編碼。

**文件：** `docs/*.md` 仍在 `.gitignore`。本分支應使用者要求以 `git add -f` 納入這三份 markdown；之後若要再更新，同樣只強制加入這三個檔，不要連帶 secrets。
| 檔案 | 用途 |
|---|---|
| [CONTRACTS.md](./CONTRACTS.md)（本檔） | 現行架構、API／資料契約、操作 |
| [METHODOLOGY.md](./METHODOLOGY.md) | 退休策劃方法論與假設／限制 |
| [WORK_LOG.md](./WORK_LOG.md) | 精簡開發時間線 |

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
  worker/src/index.js  ←  cors / auth / yahoo / mem0 / openrouter / brain / tools
      │  （Sonnet：可先 get_ticker_history）
      │  X-Proxy-Secret
      v
Vercel Proxy
  proxy/api/chat.js
      │  Authorization: Bearer <OPENROUTER_API_KEY>
      v
OpenRouter  →  Claude / DeepSeek 等

本機（開發者電腦）
  backtest/data-fetcher.js ──► 更新合成／CPI（或離線快取）──► data/
  npm run dev ──► 靜態前端 :5173 + wrangler dev :8787
```

一輪對話：

1. 前端啟動時 `GET /api/models`（不帶密碼）填模型選單；若 localStorage 沒有密碼，顯示登入框，以 `GET /api/auth-check` 驗證後存入。
2. 使用者編輯計劃／組合後重算：`runBacktest` → `realMonthlyReturns` → `simulateRetirement`，結果顯示於儀表板。
3. 送出時 `POST /`，帶 `X-App-Auth` 與 JSON（query、historySummary、lastAiResponse、model、可選 attachment、backtestContext／backtestUnchanged、lastComplexity）。
4. Worker：上一輪回覆先骨架化；回測未變可跳過重送；短續問可跳過摘要；否則差分摘要。Mem0 僅在相關時搜尋（Cache API 約 10 分鐘）。
5. **依使用者選定的模型 key**（預設 DeepSeek；舊客戶端若仍送 `auto` 則改為 DeepSeek）。**不再**依 complexity 自動升 Sonnet。
6. 若選 Sonnet 且問題像在談代號／組合：先同步一輪 `get_ticker_history`（`worker/src/tools.js`），把 tool 結果併入再 stream 正式回答。
7. 組 system（退休規劃師 prompt + 動態脈絡含【目前狀態】／持倉起點／套用回執），經 Proxy 向 OpenRouter 串流。
8. SSE 第一個 event 是 `type: "meta"`；其後是 OpenRouter token。前端把 `history_summary`、`lastComplexity`、回測 hash 寫回 localStorage。
9. 前端把回覆中的 ` ```portfolio `／` ```plan ` 區塊渲染成卡片；套用後寫入 `lastApplyReceipt` 並重算；手動套用可自動送出含回執摘要的訊息。

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
| `backtest/symbols.js` | 持倉 `TICKER.EX` 規則、`toYahooQuery`／`migrateHoldings`（前後端共用） |
| `backtest/data-fetcher.js` | 薄 facade：`ensureData` + CLI（`npm run fetch`） |
| `backtest/fetch/` | `yahoo.js`、`synthetic.js`、`cache.js` |
| `backtest/index-mapping.json` | ETF → 延伸歷史用的替代序列（可含裸別名鍵；持倉仍須後綴） |
| `backtest/cli.js` | 終端機回測；`--withdraw` 做提領測試 |
| `data/` | 僅 SYNTHETIC／CPI 與瘦身 `manifest.json`；一般 ETF 不提交 |
| `docs/` | `CONTRACTS`／`METHODOLOGY`／`WORK_LOG`（gitignore；要進版控時 `git add -f` 這三份） |
| `icon.png`、`manifest.webmanifest` | 主畫面「加入主畫面」圖示（在 `main`；見下方儀表板） |
| `scripts/dev.js` | 本機一鍵啟動前端 + Worker（服務 index／styles／js／backtest／data） |
| `worker/src/index.js` | 薄路由（含 `/api/series`）、SSE、組請求、可選工具輪 |
| `worker/src/tools.js` | AI function calling：`get_ticker_history`（Yahoo 歷史起點） |
| `worker/src/context-budget.js` | 上一輪骨架化、摘要跳過、Mem0 是否搜尋 |
| `worker/src/yahoo.js` | Yahoo 代抓，回傳與 `data/*.json` 同 shape |
| `worker/src/cors.js`／`auth.js`／`mem0.js`／`openrouter.js` | CORS、驗證、Mem0、Proxy 呼叫 |
| `worker/src/brain.js` | 退休規劃師 prompt（含收斂／代號鐵律）、摘要 prompt、`MODEL_CONFIG` |
| `worker/wrangler.toml` | Worker 名稱（`etf-backtest-worker`）、公開 vars（含 `PROXY_URL`…`/api/chat`） |
| `proxy/api/chat.js` | Vercel Edge Function：驗證後原樣轉發 OpenRouter |
| `package.json` | `npm run dev`／`fetch`／`fetch:all`／`backtest` |

---

## 回測引擎（`backtest/engine.js`）

### 價格資料格式（本地 `data/` 或 Worker `/api/series`）

```json
{
  "symbol": "SPY.US", "name": "...", "currency": "USD", "instrumentType": "ETF",
  "adjusted": true, "source": "yahoo", "fetchedAt": "ISO 時間",
  "firstDate": "1993-01-29", "lastDate": "2026-10-23",
  "series": [["1993-01-29", 24.4], ...]
}
```

- 本地 `data/` 只放 `instrumentType` 為 `SYNTHETIC`／`CPI` 的長歷史序列；其餘由前端呼叫 `GET /api/series?symbol=`（需 `X-App-Auth`）向 Yahoo 抓 adj close。
- **持倉代號**：必須 `TICKER.EX`（`VTI.US`、`IGLN.L`、`VWRD.L`、`2800.HK`）；期貨 `GC=F`。Worker／`fetch/yahoo.js` 以 `toYahooQuery` 查詢（`.US` → 裸 Yahoo 代號；其餘保留後綴）。不做裸代號→`.L` 靜默改寫。
- **Yahoo 日線**：`period1` 約最近 99 年（平台限 ~100 年／次），勿用 1900 epoch。
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
- **長歷史常見鍵**：mapping 常以裸代號（如 `VT`、`IEF`、`GLD`、`IVV`）掛合成延伸；持倉若寫 `VT.US` 則通常只有 ETF 上市後 Yahoo 段，共同起點會被截短。AI 脈絡中的【持倉歷史起點】與 `get_ticker_history` 用來避免此坑。

### `runBacktest(portfolio, mapping, dataBySymbol)`

輸入 `portfolio`：`holdings`（自動正規化）、`rebalance`（`none | monthly | quarterly | semiannual | annual`）、可選 `start`／`end`、`initial`（預設 10000）、`riskFreeRate`（預設 0）。

- 區間：所有資產（含延伸）共同可用的最長區間，再套 `start`／`end`。
- 日期：各資產日期的**聯集**，每個資產取「該日或之前最後一個價格」（可混用日線與月度、不同交易所）。
- 波動／Sharpe／Sortino 用**月報酬**年化；回撤用完整序列。

輸出關鍵欄位：`portfolio`、`period`（含 `limitingAsset`）、`finalValue`、`stats`、`annualReturns`、`assets`、`correlation`、`equityMonthly`、`warnings`。

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
| `guardrailCeiling`／`guardrailFloor` | **絕對**年提領率 %（年提領÷當下資產）；例如 `6`＝6%。**不是**相對初始提領率的加減碼 |
| `guardrailAdjustPct` | 觸發護欄後增減**支出**的百分比（例如 `10`＝砍／加 10% 支出） |
| `otherIncome`／`otherIncomeAge` | 其他收入與起始年齡 |
| `inflationMode` | `cpi`（美國 CPI）或 `fixed` |
| `inflationRate` | 固定通膨 %／年；cpi 缺月時後備 |
| `feeRate` | 費用＋成本 %／年 |
| `currency` | 顯示用幣別（不做換匯） |

前端：選「護欄法」時才顯示三個護欄欄位；標籤寫明「絕對提領率」。

### `simulateRetirement(plan, returns)`

- 以歷史**每個起始月份**模擬整段計劃（累積期 + 提領期）；歷史不足時用循環序列並標示 `method: "circular"`。
- 全部以今日幣值（實質）計算：名目月報酬扣費用後再除通膨。
- 提領規則：`fixed_real` 每年固定；`guardrails` 每年若提領率 > ceiling／< floor（絕對 %）則調整支出；`vpw` 每月提領＝剩餘資產÷剩餘月數。
- 輸出含：`successRate`、`successRateFixedReal`（彈性規則時對照）、`spendingFlexibility`（實際／目標提領比與達標月份占比）、`endBalance`、`balanceAtRetire`、`initialWithdrawalRate`、`sustainableSpending`（始終為固定實質口徑）、`withdrawalRates`（SWR／PWR）、`worstRuns`、`bands`、`byStartYear`、`history`。

---

## 已知限制

計算假設與解讀心法以 [METHODOLOGY.md](./METHODOLOGY.md) 為準。實作層摘要：

- 價格指數不含股息；`synthetic` 月度合成會平滑波動與回撤。
- 不做匯率換算，各資產以自身幣別計算。
- Sharpe／Sortino 預設 rf=0。
- 共同基金替代序列已扣基金費用，與 ETF 費用率不同。
- 計劃年限長於可用歷史時用循環序列，結果較不可靠（必須警告）。
- CPI 缺月以固定通膨替代；非美國居民使用美國 CPI 有偏差。
- 未建模：槓桿路徑依賴、稅務／遺產、bootstrap、下滑路徑。
- AI **尚無** `run_backtest` 工具（P2 延後）：正式回測仍在瀏覽器；AI 只能輸出區塊等前端套用，或透過 `get_ticker_history` 查代號起點。

---

## 各層職責

### 前端（`index.html` + `js/`）

- `WORKER_URL`（`js/config.js`）：本機（`localhost`／`127.0.0.1`）→ `http://127.0.0.1:8787/`；否則 → `https://etf-backtest-worker.davchan-clp.workers.dev/`。
- 存取密碼：不寫在原始碼。首次使用或 401 時顯示登入框，`GET /api/auth-check` 後存 `localStorage appAuth`。
- 每則訊息附 `backtestContext`（由 `js/context.js` `buildBacktestContext()` 組裝），含：
  - 【已確認事實】系統鐵律（狀態唯一真相、護欄絕對%、長歷史代號坑）
  - 【可回測代號】＋【持倉歷史起點】（含 mapping 鏈與最早年）
  - 【目前狀態】JSON（主區計劃／組合／上次回測摘要）——**唯一真相**，勿與對話閒聊舊數字混用
  - 【最近一次套用回執】（若有）
  - 退休模擬與組合回測說明文字
  - 前端以 SHA-256 指紋偵測未變時改送 `backtestUnchanged: true` 且省略全文
- **套用回執**（`buildApplyReceipt` → `state.lastApplyReceipt`）：套用 portfolio／plan 並重算後寫入。欄位含 `status`（`ok`｜`partial_data`）、`requested_start`／`actual_start`、`limiting_asset`、`warning`、`result_summary`。手動套用且 `notifyAi` 時，自動訊息會帶回執摘要。
- ` ```portfolio ` → `js/ai-controls.js` `parsePortfolioBlock()`；` ```plan ` → `parsePlanBlock()`。單組建議自動寫入主區上方表單並重算；多組則顯示卡片供挑選。
- 模型選單來自 `GET /api/models`：**DeepSeek V4.1 Flash（預設）**／**Sonnet 5.5（手動）**。無「自動」選項。
- 對話：送出後顯示「思考中…」，直到正式回覆或「連線失敗：…」。作曲區 placeholder 為「問問你的退休顧問…」（無 Shift+Enter 提示）。**沒有**迴紋針／附件預覽；`sendMessage` 仍可跑，只是不附檔。API body 的可選 `attachment` 欄位仍在，目前 UI 不送。
- 窄螢幕（`max-width: 640px`）的 `input`／`select`／`textarea` 至少 16px，避免 iOS 聚焦時自動放大。viewport 仍是 `width=device-width, initial-scale=1`，不鎖縮放。

### 儀表板（主區，由上而下）

1. **ETF 組合權重**與**退休計劃假設**在最上方（窄螢幕改上下排）。持倉編輯器保留（代號、權重、新增、再平衡、可選起迄）。可見 UI **沒有**「代號須含交易所…」長提示；代號規則仍由輸入欄 `title` 與驗證執行，持倉仍須 `TICKER.EX`。
2. 計劃欄位全部保留，排成較緊的多欄；護欄三欄僅在提領策略為護欄時出現。
3. 「退休時資產（中位）…」那條次要指標列與資產軌跡下的長說明留在 DOM 但隱藏（圖表 hover 仍看得到數值）。
4. **重新計算**在軌跡圖之後、分頁之前，`position: sticky; bottom: 0`，黏住範圍只到分頁上方：捲輸入與圖時浮在視窗底，捲到分頁就停在分頁條正上方，不蓋住面板。手機的捲動容器是 `.dash`。
5. 分頁互斥，預設 **概況**，其餘為 **歷史情境**／**組合績效**／**資產明細**（點一個就換掉前一個，不往下接）。概況是四項緊湊數字：歷史成功率、每月可花金額、初始提領率（附 SWR／PWR）、所需報酬（至退休／退休後兩段實質年化，見 `requiredPhaseReturns`）。沒有第五張永遠顯示的 KPI 卡。
6. 頂列標題是文字「退休航道」，**沒有**左側圖示。開啟對話的按鈕文字是 **退休顧問**。
7. 「加入主畫面」在 `main`：`icon.png`、`manifest.webmanifest`，以及 `<link rel="icon">`／`apple-touch-icon`。本分支的 `index.html` 尚未帶這三個 link；合併時保留 `main` 的這幾行，不要把圖示再畫回標題旁邊。

### `worker/src/index.js`（+ cors／auth／mem0／openrouter／tools）

- CORS：`ALLOWED_ORIGIN` 可為逗號分隔清單；請求 `Origin` 在清單內才回傳該來源。
- `GET /api/models` 公開；`GET /api/auth-check` 驗證密碼。
- `backtestContext` 截斷至 12000 字；`backtestUnchanged` 時不重送全文。摘要只收增量＋上一輪骨架（見 `context-budget.js`）。
- 短續問且回測未變可跳過摘要；Mem0 可跳過或走 Cache API。
- Sonnet：`maybeRunTools` 可在 stream 前執行 `get_ticker_history`（DeepSeek 路徑目前不跑 tools）。
- 不持有 `OPENROUTER_API_KEY`；打 Proxy 時帶 `X-Proxy-Secret`。`PROXY_URL` 須含 `/api/chat`。

### `worker/src/tools.js`

| 工具 | 說明 |
|---|---|
| `get_ticker_history` | 查 Yahoo 可用起點／名稱／幣別／點數。參數：`ticker`（`TICKER.EX`） |

回傳例：`{ ticker, yahooSymbol, name, currency, firstDate, lastDate, points, note }`；失敗則 `{ error }`。  
**未實作**：`run_backtest`、`get_current_state`（狀態改由前端 `backtestContext` 注入）。

### `worker/src/brain.js`

- `SHARED_CORE_SYSTEM`：退休規劃師角色、`portfolio`／`plan` 格式、**護欄絕對%**、**代號／長歷史鐵律**、**收斂規則**（少重複免責、連續一致則建議定案）。
- `SUMMARIZER_SYSTEM`：只輸出 `{ history_summary, complexity, task_tag }`（complexity 仍寫入 meta，**不再**用來選模型）。
- `DEFAULT_MODEL_KEY = 'DeepSeek-V4.1-Flash'`；`MODEL_CONFIG` 僅 DeepSeek／Sonnet。
- 動 token 預算、摘要觸發前先問專案負責人。

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

不驗證。`{ "models": [{ "key", "label", "description" }], "default": "DeepSeek-V4.1-Flash" }`。

### `GET /api/auth-check`

需 `X-App-Auth`。正確 → `200 { "ok": true }`；錯誤 → `401 { "ok": false }`。

### `GET /api/series?symbol=`

需 `X-App-Auth`。Yahoo 代抓；回應 shape 與 `data/*.json` 相同。Cache API ~24h。

### `POST /upload`

需 `X-App-Auth`。`multipart/form-data`，欄位 `file`。

### `POST /`

需 `X-App-Auth`、`Content-Type: application/json`。

**一般對話** body：`query`、`historySummary`、`lastAiResponse`、`model`、可選 `attachment`、可選 `backtestContext`、`backtestUnchanged`、`lastComplexity`。回應 `text/event-stream`：

1. `data: {"type":"meta","history_summary","complexity","task_tag","raw_summary","used_model"}`
2. 其後 OpenRouter SSE
3. Header `X-Used-Model` 為實際 key（`auto` 會被改寫成預設 DeepSeek）

**產生標題**：body 加 `"action": "generateTitle"`。

---

## ` ```portfolio ` 區塊

```portfolio
{"name": "簡短名稱", "holdings": {"VTI.US": 50, "IEF.US": 30, "GLD.US": 20}, "rebalance": "annual"}
```

- 只含一個 JSON；`holdings` 鍵必須含交易所後綴；`rebalance` 為 `none | monthly | quarterly | semiannual | annual`；可選 `start`／`end`。
- 定義在 `brain.js`，解析在 `parsePortfolioBlock()`（僅對 mapping 已知美股裸代號補 `.US`；倫敦等不靜默改寫）。

## ` ```plan ` 區塊

```plan
{"note": "改用護欄提領並略降目標支出", "retireAge": 62, "annualSpending": 280000, "withdrawalStrategy": "guardrails", "guardrailCeiling": 6, "guardrailFloor": 3, "guardrailAdjustPct": 10}
```

- 只列要改的欄位；金額為今日幣值。
- 可選 `withdrawalStrategy`：`fixed_real`｜`guardrails`｜`vpw`。
- 護欄三欄語意見上表（絕對提領率 vs 調整支出 %）。
- 定義在 `brain.js`，解析在 `parsePlanBlock()`。
- 一則回覆合計最多 3 個 portfolio／plan 區塊。

---

## 常用操作

```bash
npm run dev                           # 本機前端 + Worker
npm run fetch -- US_STOCK_TR CPI_US   # 更新合成／CPI（其餘 ETF 改由 Worker 即時抓）
npm run fetch:all                     # 含對照表代號的本機快取（可選，離線用）
npm run backtest -- "SPY:60,TLT:40" --rebalance annual
npm run backtest -- "VTI.US:60,IEF.US:40" --withdraw 4 --years 30
```

線上前端的 ETF 價格走 Worker Yahoo；只有改了合成／CPI 才需 commit `data/` 並 push。倫敦 ETF 請輸入 `VWRD.L`／`IGLN.L`（勿裸 `VWRD`）。

部署 Worker：`cd worker && npx wrangler deploy`（secrets 用 `wrangler secret put`，勿寫進 git）。

## 如何新增模型

只改 `worker/src/brain.js` 的 `MODEL_CONFIG`（必要時一併改 `DEFAULT_MODEL_KEY`）。前端下次載入會從 `GET /api/models` 同步選單。**不要**再加依 complexity 自動升模的邏輯，除非負責人明確要求。

## 相關文件

- 方法論：[METHODOLOGY.md](./METHODOLOGY.md)
- 開發過程精簡時間線：[WORK_LOG.md](./WORK_LOG.md)
