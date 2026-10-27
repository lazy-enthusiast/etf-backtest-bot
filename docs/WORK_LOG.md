# 開發紀錄（WORK_LOG）

精簡時間線。方法論見 [METHODOLOGY.md](./METHODOLOGY.md)；實作契約見 [CONTRACTS.md](./CONTRACTS.md)。  
`docs/*.md` 仍列在 `.gitignore`。儀表板分支依使用者要求以 `git add -f` 提交這三份；日常不要連帶提交 secrets。

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
- **現行（混合）**：`data/` 只留合成＋CPI；一般 ETF／基金改 Worker `GET /api/series` 代抓 Yahoo（Cache API 24h）。持倉須 `TICKER.EX`；Yahoo 日線 period1 限 ~99y。

## 前端與 Worker 重構
- 前端拆成 `styles/` + `js/` ES modules；Worker 拆 `brain`／`cors`／`auth`／`mem0`／`openrouter`／`yahoo`／`context-budget`／`tools`。
- 契約與方法論集中於本機 `docs/`（CONTRACTS／METHODOLOGY／WORK_LOG）。

## 模型與體驗
- 動態 `GET /api/models`。
- **現行**：預設 DeepSeek V4.1 Flash；Sonnet 5.5 **僅手動切換**（已移除 complexity 自動升模與「自動」選項；舊 `auto` 請求改寫為 DeepSeek）。
- 摘要／標題仍用小模型；`complexity` 仍寫入 meta，但不選模。
- 對話欄標題精簡；對話／模型選擇預設收起。
- Sonnet 5.5：`max_tokens` 64k（thinking 與正文共用）；可傳 `reasoning`。
- 脈絡預算：上一輪骨架化、回測指紋略過未變全文、短續問跳過摘要、摘要差分更新、Mem0 條件搜＋短快取。

## 反鬼打牆（2026-10）
- 根因：AI 只能輸出區塊等前端跑，無工具查代號；缺狀態單一真相與套用回饋 → 反覆 VT.US vs 長歷史、自我否定。
- **P0**：`brain.js` 代號鐵律＋收斂規則；Sonnet 前可 `get_ticker_history`（`worker/src/tools.js`）。
- **P1**：`backtestContext` 注入【目前狀態】JSON、【持倉歷史起點】、【最近一次套用回執】（`partial_data`／截斷警告）；手動套用訊息帶回執。
- **P3**：護欄 UI／prompt 標明 ceiling／floor＝**絕對**提領率 %。
- **P2 延後**：Worker 端 `run_backtest`、多方案並行。

## 退休模擬演進
- 固定實質提領 → 加 **護欄法（Guyton-Klinger）**、**VPW**；輸出含固定實質對照成功率與實際／目標提領比。
- 已知未做（刻意延後）：槓桿顯式建模、遺產稅試算、Block Bootstrap、下滑路徑、地區化通膨／幣別換算。詳見 METHODOLOGY §9。

## 代號與 Yahoo（2026-10）
- `backtest/symbols.js`：強制交易所後綴；`toYahooQuery`（`.US`→裸）；舊資料裸美股遷移補 `.US`（僅 mapping 已知美股裸鍵；不對倫敦別名靜默補 `.US`）。
- 修 Yahoo「Only 100 years worth of day granularity」：去掉 period1=1900，改 ~99 年窗口。
- 倫敦：`VWRD.L`／`IGLN.L`（裸 `VWRD` 會打錯標的）；mapping 可留裸別名鍵供 lookup，不做靜默改 `.L`。

## 部署慣例
- 前端：push `main` → GitHub Pages。
- Worker：`cd worker && npx wrangler deploy`（secrets 不進 git）。
- 改合成／CPI 才需更新並 commit `data/`；一般新 ETF 不必再塞 JSON。
- 更新方法論／契約／本紀錄：改 `docs/`。要進遠端時只 `git add -f` 這三份 markdown。

## 主畫面圖示（main，c54a589）
- `icon.png`、`manifest.webmanifest`，以及 `index.html` 的 `rel="icon"`／`apple-touch-icon`。給「加入主畫面」用，不是標題旁的標誌。

## 儀表板版面（ui/dashboard-layout，2026-10）
- 主區由上而下：ETF 權重與退休假設 → 資產軌跡 → 浮動「重新計算」（停在分頁條上方，不蓋面板）→ 互斥分頁。預設概況（四個短數字，含兩段所需報酬）；歷史情境／組合績效／資產明細會換掉概況。
- 拿掉可見的代號長提示、中位資產條、軌跡圖長說明。窄螢幕表單控制項 ≥16px（不鎖 viewport 縮放）。
- 頂列只留「退休航道」文字。按鈕改「退休顧問」。placeholder 去掉 Shift+Enter。移除迴紋針與附件預覽；送出純文字仍可用。
- 對話仍顯示「思考中…」，失敗為「連線失敗：…」。模型仍是手動：預設 DeepSeek，Sonnet 只在使用者切換時使用。
