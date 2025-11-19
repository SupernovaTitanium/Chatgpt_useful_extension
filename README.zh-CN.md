# ChatGPT 增強套件 (ChatGPT Enhancement Suite)

這是一個強大的 Chrome 擴充功能，透過自動改名、層級資料夾、Prompt 百寶箱和快速學習視窗，全面提升您的 ChatGPT 使用體驗。

> **注意**：本專案基於開源專案 [ChatGPT Conversation Timeline](https://github.com/example/repo) 開發。我們保留了其核心架構，並專注於開發以下生產力功能。

## 功能介紹

### 1. 自動改名 (Auto-rename)
自動為您的對話生成簡潔且相關的標題。
- **操作**：點擊頂部標題列的 🖊️ 圖示。
- **原理**：在背景分頁中進行摘要生成，避免影響當前對話的上下文。

### 2. 層級資料夾 (Hierarchical Folders)
將您的對話整理成樹狀結構的資料夾。
- **拖放功能**：輕鬆將對話拖入資料夾。
- **管理**：在側邊欄直接建立、重新命名或刪除資料夾。

### 3. Prompt 百寶箱 (Prompt Toolbox)
隨時調用您最常用的提示詞。
- **快速插入**：點擊輸入框旁的 ⚡ 圖示即可瀏覽並插入提示詞。
- **匯入/匯出**：支援 JSON 格式的提示詞庫分享。

### 4. 快速學習視窗 (Quick Learn Window)
在不打斷閱讀的情況下獲取解釋。
- **上下文感知**：選取文字並要求解釋。
- **無干擾**：答案顯示在浮動視窗中，且嚴格保持原本的捲動位置，讓您閱讀不中斷。

## 安裝說明

1. 下載或 Clone 此專案。
2. 打開 Chrome 並前往 `chrome://extensions/`。
3. 開啟 **開發人員模式 (Developer mode)**。
4. 點擊 **載入未封裝項目 (Load unpacked)** 並選擇 `extension` 資料夾。

## 授權

MIT