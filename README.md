# 語音對話後端部署指南

## Rawbyte (Railway) 部署步驟

### 1. 上傳代碼到 GitHub
```bash
cd voice-chat-backend
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/voice-chat-backend.git
git push -u origin main
```

### 2. 在 Rawbyte 部署
1. 登入 Rawbyte
2. 點擊 "New Project" → "Deploy from GitHub repo"
3. 選擇你的 repo
4. 添加環境變量：
   - `OPENAI_API_KEY` = 你的 OpenAI API key
   - `MINIMAX_API_KEY` = 你的 MiniMax API key  
   - `DIALOGUE_MODEL` = `minimax` 或 `openai`
5. Railway 會自動偵測並部署

### 3. 獲取 URL
部署完成後，Rawbyte 會提供一個 URL，例如：
`https://voice-chat-backend.up.railway.app`

### 4. 修改前端配置
在 index.html 中填入你的後端 URL：
- `http://YOUR-RAILWAY-URL/` 

### 5. 本地測試
```bash
cd voice-chat-backend
npm install
OPENAI_API_KEY=your_key MINIMAX_API_KEY=your_key node server.js
```

## API 端點

### POST /chat
語音對話（完整流程）

```json
{
  "audio": "base64_encoded_audio",
  "provider": "openai" // 或 "minimax"
}
```

Response:
```json
{
  "transcription": "用戶說的話",
  "response": "AI 的回覆",
  "audio": "base64_encoded_mp3_audio"
}
```

### POST /text-chat
純文字對話

```json
{
  "message": "用戶輸入的文字"
}
```

### POST /tts
文字轉語音

```json
{
  "text": "要轉換的文字",
  "provider": "openai",
  "voice": "alloy"
}
```

### GET /
健康檢查

## 環境變量

| 變量 | 必填 | 說明 |
|------|------|------|
| OPENAI_API_KEY | 二選一 | OpenAI API Key |
| MINIMAX_API_KEY | 二選一 | MiniMax API Key |
| DIALOGUE_MODEL | 否 | `minimax` (預設) 或 `openai` |
| PORT | 否 | 伺服器端口，預設 3000 |
