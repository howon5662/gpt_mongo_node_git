const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const { chatWithContext } = require("./index");

const app = express();
const PORT = process.env.PORT || 3000;
const client = new MongoClient(process.env.MONGODB_URI);

app.get("/", (req, res) => {
  res.send("서버 잘 살아있음!");
});

// 👉 미들웨어
app.use(cors());
app.use(bodyParser.json());

// 👉 요청 타임아웃 설정 (선택 사항: 응답 지연 방지용)
app.use((req, res, next) => {
  res.setTimeout(30000); // 30초
  next();
});

// ✅ Flutter에서 메시지를 보낼 API
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
    res.status(500).json({ error: err.message });
  }
});

// ✅ 서버 실행 전 DB 연결
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
