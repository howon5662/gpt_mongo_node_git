// ⏰ 자동 일기 생성기 (매일 Diarytime에 따라 일기 생성)
const { MongoClient } = require("mongodb");
const { generateDiarySinceLast } = require("./diary");
require("dotenv").config();

const client = new MongoClient(process.env.MONGODB_URI);
const dbName = "gpt_project";

async function createAutoDiaries() {
  try {
    const db = client.db(dbName);
    const usersCol = db.collection("user_settings");

    const allUsers = await usersCol.find({ Diarytime: { $exists: true } }).toArray();

    for (const user of allUsers) {
      const userId = user.user_id;
      const diaryTimeStr = user.Diarytime; // 예: "03:00"
      const [hour, minute] = diaryTimeStr.split(":").map(Number);
      const now = new Date();

      const diaryTimeToday = new Date(now);
      diaryTimeToday.setHours(hour, minute, 0, 0);

      const diffMs = Math.abs(now - diaryTimeToday);

      // ⏰ 현재 시간이 Diarytime ±10분 이내일 때만 실행
      if (diffMs <= 10 * 60 * 1000) {
        // 📅 diaryDate 결정 기준:
        // Diarytime 자체가 00:01 ~ 06:00이면 → 전날
        // Diarytime이 06:01 이후면 → 당일
        let diaryDate;
        if (hour < 6 || (hour === 6 && minute === 0)) {
          diaryDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        } else {
          diaryDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }

        console.log(`📝 ${userId}의 자동 일기 생성 중... (기준일: ${diaryDate.toISOString().slice(0,10)})`);
        await generateDiarySinceLast(userId, diaryDate); // 🎯 기준일 전달
      }
    }
  } catch (err) {
    console.error("❌ 자동 일기 생성 오류:", err);
  }
}

// 단독 실행 가능하게 구성
if (require.main === module) {
  createAutoDiaries();
}

module.exports = { createAutoDiaries };
