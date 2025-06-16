// ✅ server.js
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");
const { chatWithContext, summarizeHistory } = require("./index");
const { createAutoDiaries } = require("./AutoDiaryWriter");
const { generateDiarySinceLast } = require("./diary");
const cron = require("node-cron");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const client = new MongoClient(process.env.MONGODB_URI);

app.get("/", (req, res) => {
  res.send("서버 잘 살아있음!");
});

app.use(cors());
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.setTimeout(30000);
  next();
});

// ✅ 대화 처리
app.post("/chat", async (req, res) => {
  const { user_id, message } = req.body;
  if (!user_id || !message) return res.status(400).json({ error: "user_id와 message는 필수입니다." });
  try {
    const reply = await chatWithContext(user_id, message);
    res.json({ reply });
  } catch (err) {
    console.error("❌ GPT 처리 중 오류:", err);
    res.status(500).json({ error: "서버 오류 발생" });
  }
});

// ✅ 프론트에서 date(보고싶은 날짜)전달 시 db에서 저장된 일기 조회
// ✅ 기존 라우터에서 교체
app.get("/diary", async (req, res) => {
  const userId = req.query.user_id;
  const dateStr = req.query.date; // 예: "2025-06-16"

  if (!userId || !dateStr) {
    return res.status(400).json({ error: "user_id와 date가 필요합니다." });
  }

  try {
    const db = client.db("gpt_project");
    const diaryCol = db.collection("diary");

    // ✅ 범위 날짜 계산 (KST 기준 하루 전체 범위)
    const targetDate = new Date(dateStr); // 2025-06-16T00:00:00.000 (로컬 기준)
    const nextDate = new Date(targetDate);
    nextDate.setDate(targetDate.getDate() + 1);

    const doc = await diaryCol
      .find({
        user_id: userId,
        diaryDate: {
          $gte: targetDate,
          $lt: nextDate
        }
      })
      .sort({ _id: -1 }) // 최신순 정렬
      .limit(1)
      .next(); // 커서에서 하나 꺼냄

    if (!doc) return res.status(404).json({ error: "일기 없음" });

    res.json({ diary: doc.diary, emotion: doc.emotion ?? null }); // 👈 감정도 함께 전송
  } catch (err) {
    console.error("❌ 일기 조회 오류:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});


// ✅ /writeDiary: 프론트에서 일기 작성 요청 시, 일기 생성 및 DB 저장
app.post("/writeDiary", async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id는 필수입니다." });
  try {
    await generateDiarySinceLast(user_id);
    res.status(200).json({ message: "일기 저장 완료" });
  } catch (err) {
    console.error("❌ writeDiary 오류:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});


app.get("/calendarEmotion", async (req, res) => {
  const { user_id, year, month } = req.query;
  if (!user_id || !year || !month) return res.status(400).json({ error: "user_id, year, month가 필요합니다." });

  try {
    const db = client.db("gpt_project");
    const diaryCol = db.collection("diary");

    const y = parseInt(year);
    const m = parseInt(month);

    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 1);

    const diaries = await diaryCol.find({
      user_id,
      diaryDate: {
        $gte: monthStart,
        $lt: monthEnd
      },
      emotion: { $exists: true }
    }).toArray();

    const emotionList = diaries.map(entry => ({
      date: entry.diaryDate.toISOString().split("T")[0],
      finalEmotion: entry.emotion  // 👉 실제 DB에는 'emotion' 필드지만, 프론트에서는 'finalEmotion'이라는 키로 받음, 이게 마지막 emojiEmotion

    }));

    res.json({ emotions: emotionList });
  } catch (err) {
    console.error("❌ calendarEmotion 오류:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});



// ✅ diaryTime DB의 user_settings에 저장
app.post("/diaryTime", async (req, res) => {
  const { user_id, diaryTime } = req.body;
  if (!user_id || !diaryTime) return res.status(400).json({ error: "user_id와 diaryTime이 필요합니다." });
  try {
    const db = client.db("gpt_project");
    const settingsCol = db.collection("user_settings");
    await settingsCol.updateOne(
      { user_id },
      { $set: { Diarytime: diaryTime } },
      { upsert: true }
    );
    res.json({ message: "diaryTime 저장 완료" });
  } catch (err) {
    console.error("❌ diaryTime 저장 오류:", err);
    res.status(500).json({ error: "서버 오류" });
  }
});

(async () => {
  try {
    await client.connect();
    console.log("✅ MongoDB 연결 완료");
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
