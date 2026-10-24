# 開發紀錄（WORK_LOG）

精簡時間線。現行契約與架構見 [CONTRACTS.md](./CONTRACTS.md)。

## 起源
- 由 **deep-water** 幕僚 chatbot 改造：Cloudflare Worker → Vercel Proxy → OpenRouter；前端靜態頁 + 存取密碼。
- Worker 更名為 `etf-backtest-worker`；Mem0 `user_id` 與 deep-water 分開。

## 產品定調：退休航道
- 瀏覽器內 ETF 組合回測（`engine.js`）＋退休模擬（`retirement.js`：實質報酬、歷史起始月、SWR／PWR、成功率）。
- AI 讀取 `backtestContext`，可輸出 ` ```portfolio `／` ```plan ` 區塊，前端一鍵套用並重算。
- UI：左約 2/3 計劃／儀表板，右約 1/3 對話；未驗證前模糊鎖定。

## 資料與長歷史
- 初版：本機 `npm run fetch` 抓 Yahoo → `data/*.json` commit → Pages 提供（CORS 無法直連 Yahoo）。
- `index-mapping.json`：ETF 上市前接共同基金／指數／合成序列。
- 免費長序列：Shiller／FRED／黃金等 → `US_STOCK_TR`、`US_10Y_TR`、`US_BILL_TR`、`GOLD_SPOT`、`CPI_US`。
- **現行（混合）**：`data/` 只留合成＋CPI；一般 ETF／基金改 Worker `GET /api/series` 代抓 Yahoo（Cache API 24h）。任意 Yahoo 代號可直接回測。

## 前端與 Worker 重構
- 前端拆成 `styles/` + `js/` ES modules；Worker 拆 `brain`／`cors`／`auth`／`mem0`／`openrouter`（後加 `yahoo`）。
- 契約集中於 `docs/CONTRACTS.md`（取代早期 shared 路徑）。

## 模型與體驗
- 動態 `GET /api/models`；自動路由依摘要 complexity。
- 池：Sonnet／Opus、DeepSeek Flash（摘要與可選回答）、標題用小模型。
- 對話欄標題精簡；對話／模型選擇預設收起。
- Sonnet／Opus：`max_tokens` 64k（thinking 與正文共用）；可傳 `reasoning`。
- 脈絡預算：上一輪骨架化、回測指紋略過未變全文、短續問跳過摘要、摘要差分更新、Mem0 條件搜＋短快取。

## 退休模擬演進
- 固定實質提領 → 加 **護欄法（Guyton-Klinger）**、**VPW**；輸出含固定實質對照成功率與實際／目標提領比。
- 已知未做（刻意延後）：槓桿顯式建模、遺產稅試算、Block Bootstrap、下滑路徑、地區化通膨／幣別換算。

## 部署慣例
- 前端：push `main` → GitHub Pages。
- Worker：`cd worker && npx wrangler deploy`（secrets 不進 git）。
- 改合成／CPI 才需更新並 commit `data/`；一般新 ETF 不必再塞 JSON。
