// ✅ 최종 server.js (Firebase 인증 제거 + 요약 기능 추가)
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
const { chatWithContext, summarizeHistory } = require("./index"); // summarizeHistory 추가
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const client = new MongoClient(process.env.MONGODB_URI);

// 기본 라우터
app.get("/", (req, res) => {
  res.send("서버 잘 살아있음!");
});

// 미들웨어 설정
app.use(cors());
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.setTimeout(30000); // 30초 타임아웃
  next();
});

// ✅ 대화 처리 (Firebase 인증 없이 user_id만 사용)
app.post("/chat", async (req, res) => {
  const { user_id, message } = req.body;

  if (!user_id || !message) {
    return res.status(400).json({ error: "user_id와 message는 필수입니다." });
  }

  try {
    const reply = await chatWithContext(user_id, message);
    res.json({ reply });
  } catch (err) {
    console.error("❌ GPT 처리 중 오류:", err);
    res.status(500).json({ error: "서버 오류 발생" });
  }
});

// ✅ 요약 요청 처리 (Flutter -> GPT 요약)
app.post("/summary", async (req, res) => {
  const { history, tone } = req.body;

  if (!history || !Array.isArray(history)) {
    return res.status(400).json({ error: "history는 배열이어야 합니다." });
  }

  try {
    const summary = await summarizeHistory(history, tone || "기본");
    res.json({ response: summary });
  } catch (err) {
    console.error("❌ 요약 실패:", err);
    res.status(500).json({ error: "요약 중 오류 발생" });
  }
});

// MongoDB 연결 후 서버 실행
(async () => {
  try {
    await client.connect();
    console.log("✅ MongoDB 연결 완료");
    app.listen(PORT, () => {
      console.log(`🚀 GPT API 서버 실행 중: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB 연결 실패:", err);
    process.exit(1);
  }
})();
