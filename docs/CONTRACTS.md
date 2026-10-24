# etf-backtest-bot 系統架構

個人用 ETF 投資組合回測工具，附 AI 對話框：在瀏覽器回測由 ETF 組成的組合，AI 讀取回測結果、提出改良組合，使用者一鍵套用並重新回測，結果自動回傳 AI 繼續調整。

前端是靜態 HTML（GitHub Pages），回測在瀏覽器執行，價格資料是 repo 內的靜態 JSON。AI 對話經 Cloudflare Worker → Vercel Proxy → OpenRouter。本 repo 由 deep-water 幕僚 chatbot 改造而來。

三層（前端／Worker／Proxy）各有存在理由，不要合併。改請求／回應 shape 時，同步檢查 `index.html`、Worker、Proxy。所有金鑰走環境變數，不要硬編碼。

---

## 系統架構總覽

```
瀏覽器 (GitHub Pages)
  index.html  ── import ──►  backtest/engine.js
      │  fetch（同源靜態檔）
      ├──────────────────►  backtest/index-mapping.json、data/manifest.json、data/*.json
      │
      │  X-App-Auth（使用者輸入的密碼，存在 localStorage）
      v
Cloudflare Worker（etf-backtest-worker）
  worker/src/index.js  ←  import  worker/src/brain.js
      │  X-Proxy-Secret
      v
Vercel Proxy
  proxy/api/chat.js
      │  Authorization: Bearer <OPENROUTER_API_KEY>
      v
OpenRouter  →  Claude / 其他模型

本機（開發者電腦）
  backtest/data-fetcher.js ──► Yahoo Finance ──► data/*.json（commit 後隨 GitHub Pages 發布）
```

一輪對話：

1. 前端啟動時 `GET /api/models`（不帶密碼）填模型選單；若 localStorage 沒有密碼，顯示登入框，以 `GET /api/auth-check` 驗證後存入。
2. 送出時 `POST /`，帶 `X-App-Auth` 與 JSON（query、historySummary、lastAiResponse、model、可選 attachment、backtestContext）。
3. Worker 驗證後平行跑摘要（deepseek-v4-flash）與 Mem0 檢索。
4. 依 `complexity` 或使用者指定的 key 選模型，組 system（分析師 prompt + 動態脈絡，含回測結果），經 Proxy 向 OpenRouter 串流。
5. SSE 第一個 event 是 `type: "meta"`；其後是 OpenRouter token。前端把 `history_summary` 寫回 localStorage。
6. 前端把回覆中的 ` ```portfolio ` 區塊渲染成卡片；按「套用並回測」→ 填入面板 → 瀏覽器回測 → 自動送出一則摘要訊息（附完整 backtestContext）讓 AI 繼續分析。

---

## 目錄結構

| 路徑 | 用途 |
|---|---|
| `index.html` | 前端：對話、登入框、回測面板、淨值曲線（Chart.js）、portfolio 卡片；部署於 GitHub Pages |
| `.nojekyll` | 讓 GitHub Pages 原樣提供檔案 |
| `backtest/engine.js` | 回測核心。純計算、無 I/O，Node 與瀏覽器共用 |
| `backtest/data-fetcher.js` | Node 專用：從 Yahoo Finance 抓價格寫入 `data/`，更新 `data/manifest.json` |
| `backtest/index-mapping.json` | ETF → 延伸歷史用的替代序列 |
| `backtest/cli.js` | 終端機回測 |
| `data/` | 價格快取（每個代號一個 JSON）與 `manifest.json`；需提交進 git |
| `worker/src/index.js` | 路由、驗證、Mem0、SSE、組請求 |
| `worker/src/brain.js` | 分析師 prompt、摘要 prompt、模型清單、`pickModelKey` |
| `worker/wrangler.toml` | Worker 名稱（`etf-backtest-worker`）、公開 vars |
| `proxy/api/chat.js` | Vercel Edge Function：驗證後原樣轉發 OpenRouter |
| `package.json` | `npm run fetch` / `fetch:all` / `backtest` |

---

## 回測引擎（`backtest/`）

### 價格資料格式（`data/<檔名>.json`）

```json
{
  "symbol": "SPY", "name": "...", "currency": "USD", "instrumentType": "ETF",
  "adjusted": true, "source": "yahoo", "fetchedAt": "ISO 時間",
  "firstDate": "1993-01-29", "lastDate": "2026-10-23",
  "series": [["1993-01-29", 24.4], ...]
}
```

- 價格為 Yahoo 調整收盤價（含股息與分割調整）；指數沒有調整價時用收盤價。
- 檔名由 `symbolToFile()` 產生：`^GSPC` → `IDX_GSPC.json`、`GC=F` → `GC_F.json`。
- `data/manifest.json`：`{ updatedAt, symbols: { [代號]: { name, currency, firstDate, lastDate } } }`，前端用它列出可回測代號，不必下載全部價格檔。

### 延伸歷史（`index-mapping.json`）

```json
{ "etfs": { "SPY": { "name": "...", "index": "S&P 500", "proxies": [
  { "symbol": "VFINX", "type": "mutual_fund", "note": "..." },
  { "symbol": "^GSPC", "type": "price_index", "note": "..." }
]}}}
```

- 先用 ETF 自身價格；ETF 上市前依 `proxies` 順序往前拼接。拼接以報酬率銜接（在拼接點按比例縮放），不是直接接價格。
- `type`：`mutual_fund`（含息、已扣費用，優先）、`etf`、`total_return_index`、`price_index`（不含股息，會產生警告）、`futures`。
- 不在表內的代號只用自身歷史。

### `runBacktest(portfolio, mapping, dataBySymbol)`

輸入 `portfolio`：`holdings`（`{ SPY: 60, TLT: 40 }`，自動正規化）、`rebalance`（`none | monthly | quarterly | semiannual | annual`，預設 `annual`）、可選 `start`／`end`、`initial`（預設 10000）、`riskFreeRate`（預設 0）。

- 區間：所有資產（含延伸）共同可用的最長區間，再套 `start`／`end`。
- 日期：各資產交易日的交集（混合港股／美股時以共同交易日計算，報酬仍正確累積）。
- 再平衡：進入新期間的第一個共同交易日收盤時重設權重。

輸出（前端 `describeResult()`、`renderBacktestResult()` 依賴此 shape）：

| 欄位 | 內容 |
|---|---|
| `portfolio` | 正規化後的 `holdings`（`[{ symbol, weight }]`）、`rebalance`、`initial`、`riskFreeRate` |
| `period` | `start`、`end`、`years`、`limitingAsset`（起點受哪個資產限制） |
| `finalValue` | 期末金額 |
| `stats` | `cagr`、`volatility`、`sharpe`、`sortino`、`calmar`、`maxDrawdown`、`peakDate`、`troughDate`、`recoveryDate` |
| `annualReturns` | `[{ year, return, partial }]` |
| `assets` | 各資產同期間 `cagr`、`volatility`、`maxDrawdown`、`historyStart`、`dataSources`（拼接段） |
| `correlation` | `{ symbols, matrix }`，月報酬相關係數 |
| `equityMonthly` | `[[date, value], ...]`，每月最後一個交易日 |
| `warnings` | 字串陣列（缺資料、回測區間內用到價格指數等） |

### 已知限制

- 價格指數不含股息，報酬被低估（^HSI 最明顯）。
- 不做匯率換算，各資產以自身幣別計算。
- Sharpe／Sortino 預設 rf=0。
- 共同基金替代序列已扣基金費用，與 ETF 費用率不同；未做費用調整。

---

## 各層職責

### `index.html`

- `WORKER_URL`：在 localhost 時指向 `http://localhost:8787/`（`wrangler dev`），否則指向 `etf-backtest-worker`。
- 存取密碼：不寫在原始碼。首次使用或收到 401 時顯示登入框，`GET /api/auth-check` 驗證後存在 localStorage `appAuth`。頂列「🔑 密碼」可更換。
- 回測面板：組合以 `conv.portfolio` 存在各對話中；切換對話時自動載入並重跑。記憶體中保留「上一版」結果，用於指標對照與曲線疊圖。
- 每則訊息附 `backtestContext`（`buildBacktestContext()`）：可回測代號清單（含最早年份）、目前組合完整結果、上一版精簡結果。
- ` ```portfolio ` 區塊 → `parsePortfolioBlock()` 驗證 → `buildPortfolioCard()`。JSON 無效（例如串流尚未完成）時保留為程式碼區塊。
- 「套用並回測」：回測成功且 AI 未在回覆中時，自動送出摘要訊息；否則只更新面板並提示。

### `worker/src/index.js`

- CORS：`ALLOWED_ORIGIN`；允許 `GET, POST, OPTIONS`。
- `GET /api/models`：公開。`GET /api/auth-check`：驗證 `X-App-Auth`，回 `{ ok }`（200／401），不呼叫模型。
- `POST /upload`、`POST /`：timing-safe 比對 `X-App-Auth` 與 `env.NAME`。
- System 兩塊：`SHARED_CORE_SYSTEM`（`cache_control: ephemeral`）+ 動態脈絡（長期記憶、摘要、上一輪回覆、`【目前回測結果】`）。`backtestContext` 截斷至 12000 字，不送給摘要模型。
- 不持有 `OPENROUTER_API_KEY`；打 Proxy 時帶 `X-Proxy-Secret`。

### `worker/src/brain.js`

- `SHARED_CORE_SYSTEM`：ETF 投資組合分析師角色、分析守則、` ```portfolio ` 輸出格式（前端契約）。改動影響 prompt caching 成本。
- `SUMMARIZER_SYSTEM`：只輸出 `{ history_summary, complexity, task_tag }`；摘要保留使用者目標與限制、試過的組合與結果、目前最佳候選。
- `MODEL_CONFIG`、`DEFAULT_MODEL_KEY`、`pickModelKey`：與 deep-water 相同（`<= 4` → Haiku-4.5，否則 Sonnet-5）。

動 token 預算、摘要觸發、模型選擇前先問專案負責人。

### `proxy/api/chat.js`

- Vercel Edge。驗證 `x-proxy-secret`，注入 `Authorization: Bearer OPENROUTER_API_KEY`，原樣轉發到 OpenRouter。可與 deep-water 共用同一個部署。

---

## 環境變數與 Secret

**不要把實際值寫進 repo 或本文件。** `wrangler.toml` `[vars]` 只放非機密公開值；本機開發用 `worker/.dev.vars`（已 gitignore）。

### Cloudflare Worker

| 變數 | 用途 |
|---|---|
| `NAME` | 前端存取密碼（名稱易誤導，它是密鑰）。前端不硬編碼 |
| `PROXY_URL` | Vercel Proxy URL（含 `/api/chat`） |
| `PROXY_SECRET` | 打 Proxy 的 `X-Proxy-Secret` |
| `MEM0_API_KEY` | Mem0 API |
| `MEM0_USER_ID` | Mem0 使用者 ID；與 deep-water 分開 |
| `ALLOWED_ORIGIN` | CORS 允許來源 |
| `MY_BUCKET` | R2 binding（`POST /upload`；未綁定則上傳不寫物件） |

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

**一般對話** body：`query`、`historySummary`、`lastAiResponse`、`model`、可選 `attachment`、可選 `backtestContext`（字串）。回應 `text/event-stream`：

1. `data: {"type":"meta","history_summary","complexity","task_tag","raw_summary","used_model"}`
2. 其後 OpenRouter SSE（`choices[0].delta.content`）
3. Header `X-Used-Model` 為實際 key

**產生標題**：body 加 `"action": "generateTitle"`、`query`、`lastAiResponse`。回應 `{ "title": "..." }`。

---

## ` ```portfolio ` 區塊（AI → 前端契約）

```portfolio
{"name": "簡短名稱", "holdings": {"VTI": 50, "TLT": 30, "GLD": 20}, "rebalance": "annual"}
```

- 只含一個 JSON 物件；`holdings` 值為權重百分比；`rebalance` 為 `none | monthly | quarterly | semiannual | annual`（無效值前端改用 `annual`）；可選 `start`／`end`（`YYYY-MM-DD`）。
- 格式定義在 `brain.js`，解析在 `index.html` 的 `parsePortfolioBlock()`。改任一邊要同步。

---

## 常用操作

```bash
npm run fetch -- QQQ GLD          # 抓指定 ETF 及其替代序列，更新 manifest
npm run fetch:all                 # 抓對照表內全部代號
npm run fetch -- SPY --refresh    # 強制重抓（更新到最新價格）
npm run backtest -- "SPY:60,TLT:40" --rebalance quarterly --start 1990-01-01
```

抓完要 commit `data/` 並 push，GitHub Pages 上的前端才看得到。

本機完整測試：

```bash
npx http-server -p 5173 -c-1                       # repo 根目錄，提供前端與 data/
cd worker && npx wrangler dev --port 8787 --var ALLOWED_ORIGIN:http://localhost:5173
```

## 如何新增模型

只改 `worker/src/brain.js` 的 `MODEL_CONFIG`（必要時一併改 `DEFAULT_MODEL_KEY`、`pickModelKey`）。前端下次載入會從 `GET /api/models` 同步選單。`auto` 不要加 `model`／`max_tokens`；`index.js` 的 fallback 是 `MODEL_CONFIG['Sonnet-5']`。
