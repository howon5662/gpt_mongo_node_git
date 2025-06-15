// ✅ 최종 server.js (Firebase 인증 제거 + 요약 기능 추가 + 자동일기 cron)
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
const { chatWithContext, summarizeHistory } = require("./index");
const { createAutoDiaries } = require("./AutoDiaryWriter"); // ⏰ 자동일기 추가
const cron = require("node-cron");
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

// ✅ 저장된 일기 조회
app.get("/diary", async (req, res) => {
  const userId = req.query.user_id;
  const date = req.query.date; // 예: "2024-06-10"

  if (!userId || !date) {
    return res.status(400).json({ error: "user_id와 date가 필요합니다." });
  }

  try {
    const db = client.db("gpt_project");
    const diaryCol = db.collection("diary");

    const doc = await diaryCol.findOne({
      user_id: userId,
      created_at: {
        $gte: new Date(`${date}T00:00:00.000Z`),
        $lt: new Date(`${date}T23:59:59.999Z`)
      }
    });

    if (!doc) return res.status(404).json({ error: "일기 없음" });

    res.json({ diary: doc.diary });
  } catch (err) {
    console.error("❌ 일기 조회 오류:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

// MongoDB 연결 후 서버 실행
(async () => {
  try {
    await client.connect();
    console.log("✅ MongoDB 연결 완료");

    // ⏰ 자동 일기 스케줄 시작
    cron.schedule("* * * * *", async () => {
      console.log("⏳ 자동 일기 생성 체크 중...");
      await createAutoDiaries();
    });

    app.listen(PORT, () => {
      console.log(`🚀 GPT API 서버 실행 중: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ MongoDB 연결 실패:", err);
    process.exit(1);
  }
})();
