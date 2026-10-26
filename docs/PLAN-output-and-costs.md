# 產出、稅與成本：實作順序

只規劃，不含計算改動。基準是 `origin/main` 上的 `backtest/retirement.js` 與 `backtest/engine.js`。每一步都是加料：新開關預設關閉，關閉時數字必須與今天一致（驗收 3）。

## 今天已經有的

- **一條費用**：`plan.feeRate`（%／年）在 `realMonthlyReturns` 裡變成月因子 `(1 - feeRate/100)^(1/12)`，乘在組合淨值報酬上，再除通膨。沒有 TER、再平衡換手、匯率價差的分項。
- **通膨**：`inflationMode` 為 `cpi`（美國 CPI 月對月）或 `fixed`。CPI 缺月就改用 `inflationRate`，並累計 `cpiFallbackMonths`。這個次數已在結果裡（`realMonthlyReturns` 的回傳、儀表板警告、軌跡說明）。沒有逐月「本月是否用了替代通膨」的欄位。
- **護欄是絕對提領率**：`annualSpend / 當下資產`，門檻是 ceiling／floor 的百分數，不是相對初始提領率。檢查點是退休後每滿 12 個月（`(k - retireMonth) % 12 === 0`）。提領本身每月 `annualSpend/12`。VPW 是餘額÷剩餘月數。沒有獨立的「提領頻率／檢查頻率」參數。
- **現金流在月初、報酬在其後**：累積期加 `monthlyContribution`；自 `otherIncomeAge` 起加其他收入／12；退休後再扣提領；餘額若小於 0 先歸零，然後乘上該月實質報酬。
- **一條組合報酬**：退休模擬吃的是固定權重回測出來的 `equityMonthly`，不是逐資產路徑。再平衡只在 `engine.js`（`none|monthly|quarterly|semiannual|annual`）把權重扳回目標，不計換手成本，也不把實際權重交出來。
- **沒有匯率**。`currency` 只供顯示（預設 HKD）。Sharpe／Sortino 的 `riskFreeRate` 預設 0，這份計劃不動它。
- **歷史不夠長就循環**：計劃月數大於報酬月數時 `method: "circular"`（SWR／PWR 視窗另計一次）。循環是接回同一條序列，不是另抽一條。
- **股息沒有拆開**。`price_index` 片段會警告「價格指數，不含股息」。Yahoo 調整收盤即使含息，程式也只留下一條價格，沒有股息現金流。不能把現有價格當成「已分開的股息」。
- **已公布、可對帳的數字**：每個起點的 `success`、`endBalance`、`balanceAtRetire`、`depletedAge`、`spendRatio`（累計提領÷目標）、`coverageRate`、固定實質的 `maxSpending`；按年齡的餘額分位（p10／p25／p50／p75／p90）；可持續支出分位來自固定實質的 `maxSpending`，**不是**累計提領的分位。迴圈裡的逐月提領與餘額算完即丟，沒有 CSV。

## 還沒有、不要假裝已有

`tax_paid`、`fx_rate_used`、`equity_weight_actual`、逐月 CPI 替代旗標、股息金額、TER／換手／價差分項。P0-1 不要輸出這些欄。它們在下面寫明的步驟才出現。

## 建議順序

1. **P0-1 路徑帳本（第一個 PR 只做這個）**  
   在 `retirement.js` 旁加純函數（仍無 I/O），把現有迴圈已經算出的量寫成列。建議逐月，因為累計提領必須能加總：
   - `start_month`、`k`、`return_month`（循環時是實際用到的那個月）、`circular`
   - `contribution`、`other_income`、`withdrawal`（只計從組合提出的金額）
   - `real_return`（已含今天那一條 feeRate 與通膨，不要再拆）
   - `balance_after_flows`、`balance_end`、`depleted`
   - 路徑摘要可另表：`success`、`end_balance`、`balance_at_retire`、`total_withdrawal`、`spend_ratio`、`depleted_age`；檔頭可放已有的純量 `feeRate`、`inflationMode`、`cpiFallbackMonths`、`history.method`  
   若要公布「累計提領分位」，定義就是各路徑 `sum(withdrawal)` 的分位，且必須等於 CSV 加總。不要另造一個對不上欄位的百分位。`simulateRetirement` 現有輸出的數字不得因匯出而改變。

2. **P0-2 下滑路徑**  
   在帳本之後。每個月仍使用同一條歷史索引 `(start+k)`，只改該月的目標權重；不要因為進入下一段就重抽或換一條起點。這需要按權重（或股／債袖套）對齊的報酬，不能只靠今天那一條混合淨值。帳本這時才加 `equity_weight_actual`。不同權重路徑的成功率不能橫比，循環拼接的路徑也要沿用現有 `circular` 警告。

3. **P1-3 只對股息課稅，依註冊地**  
   預設關。必須另給股息率假設（每標的或每註冊地一條）。價格序列沒有分開的股息，`price_index` 甚至不含息。不要把 Yahoo 價格說成已經拆息。關閉時不產生 `tax_paid`、不改報酬。開啟後帳本才加 `tax_paid`。

4. **P1-4 拆費用**  
   TER、再平衡換手成本、匯率價差分開，預設關。關閉時仍只用今天的 `feeRate` 月因子。開啟後才在帳本加這三個成本欄，並註明它們與舊 `feeRate` 是替代還是加總（預設替代且關＝舊公式）。

5. **P1-5 匯率與支出貨幣籃，放在成本項的最後**  
   預設關。關閉時不做換匯，`currency` 仍只是標籤。開啟後才加 `fx_rate_used`。HKD 對 USD 標成聯繫匯率假設，不是一條自由波動的歷史匯率；TWD 必須有明確匯率序列，不能沿用港幣聯繫。支出籃是權重，預設 100% 計劃幣別。

6. **P2-6 把已有的通膨選擇說清楚**  
   不新做一套通膨。把 `inflationMode` 與 `cpiFallbackMonths` 放在結果旁邊（主線的軌跡說明與警告裡已經有）。逐月「本月用了替代通膨」現在沒有，要做就在這一步從 `realMonthlyReturns` 透出，不要在 P0-1 先造一個沒有來源的欄。

7. **P2-7 區塊拔靴**  
   額外模式，不取代歷史起點。預設仍是今天的 rolling／circular。關閉時路徑集合與現在相同。

8. **P2-8 提領頻率與護欄檢查頻率**  
   帳本已在，差異才看得見。預設等於今天：每月提領、護欄每 12 個退休月檢查一次。

## 不要做

- 不做參數最佳化（不搜尋提領率、權重或費用來抬高成功率）。
- 不為了成功率拉長或縮短歷史。
- 在稅與匯率模組存在且能關掉之前，不把新成功率拿去和舊成功率比。可比的只有「新模組關閉」對上今天的基線。

## 驗收

1. 同一輸入跑兩次，帳本與 `simulateRetirement` 摘要逐項相同。
2. CSV 的 `withdrawal` 加總後，其分位等於所公布的累計提領分位；年底餘額分位等於現有 `bands`。
3. 稅、匯率、下滑路徑（以及 P1-4 的費用拆分、P2-7 拔靴、P2-8 頻率）預設關閉，關閉時與現有基線一致。

## 進度

- P0-1：已做。逐月列只在 `buildLifeLedger`（測試）與同一次 walk 裡存在；`simulateRetirement` 只留下 `spendingBrief` 與 `cumWithdrawal`。畫面在 KPI 下兩行（本分支沒有概況分頁）。

## 第一個 PR 只做 P0-1

做：無 I/O 的帳本函數、欄位如上、一個 Node 測試（兩次相同、提領加總對得上分位、`simulateRetirement` 與基線一致）。

不做：下滑權重、股息率、TER／換手／價差、匯率、拔靴、提領頻率、最佳化、改歷史長度、改 Sharpe、改儀表板版面、下載按鈕。

## 誰讀這些數字

使用者不會下載、也不會逐格讀帳本。細項是給 AI 顧問看的，走現有 `backtestContext`。Worker 截斷上限仍是 `MAX_BACKTEST_CONTEXT_CHARS`（12000）。不要加大 token 預算，也不要改摘要觸發或選模。

完整路徑帳本只留在記憶體裡，算完摘要就丟掉。不做資料庫、不把整本帳寫進 localStorage、不做下載按鈕。驗收 2 的 CSV 只在測試行程裡組出來核對分位，不是產品。

P0-1 之後放進對話脈絡的是摘要，不是逐月矩陣：

- 最差路徑上，實質年支出最低的那一年：金額，以及年齡或年份。
- 支出波動：實際提領相對目標。
- 護欄連續下調最長的一段，以及單次最大下調。
- 最差起點的簡短逐年支出（不是每個月、也不是每一條路徑）。

## 儀表板建議（先考慮，不在 P0-1 實作）

放在既有的「概況」裡，保持緊湊。不要四張新的長卡，也不要新頁面。預設關閉的模組不出現時，畫面維持今天的樣子。

- P0-1 之後最多兩個重點：最緊的一年（實質支出與年齡）、護欄一行（最長連續下調與單次最大下調）。
- 下滑路徑、股息稅、費用拆分、匯率收在進階輸入，只有打開才顯示。打開時各加一行結果：實際股權重區間；有這個模組與沒有時的支出對照。
- 通膨維持一個短標籤：CPI 或固定，加上已經算好的缺月次數。不要列出缺了哪些月。
- 不要加稅、匯率或每一條路徑的圖。
