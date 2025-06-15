// ⏰ 자동 일기 생성기 (매일 Diarytime에 따라 일기 생성)
const { MongoClient } = require("mongodb");
const { generateDiarySinceLast } = require("./diary");
require("dotenv").config();

const client = new MongoClient(process.env.MONGODB_URI);
const dbName = "gpt_project";

async function createAutoDiaries() {
  try {
    // ❌ client.connect()와 close()는 여기서 제거해야 함!
    const db = client.db(dbName);
    const usersCol = db.collection("user_settings");

    const allUsers = await usersCol.find({ Diarytime: { $exists: true } }).toArray();

    for (const user of allUsers) {
      const userId = user.user_id;
      const diaryTime = user.Diarytime; // e.g. "03:00"

      const [hour, minute] = diaryTime.split(":").map(Number);
      const now = new Date();

      const diaryTimeToday = new Date();
      diaryTimeToday.setHours(hour, minute, 0, 0);

      const diffMs = Math.abs(now - diaryTimeToday);

      if (diffMs <= 10 * 60 * 1000) {
        console.log(`📝 ${userId}의 자동 일기 생성 중...`);
        await generateDiarySinceLast(userId);
      }
    }
  } catch (err) {
    console.error("❌ 자동 일기 생성 오류:", err);
  }
  // ✅ finally 블록에서 client.close() 삭제
}


// 단독 실행 가능하게 구성
if (require.main === module) {
  createAutoDiaries();
}

module.exports = { createAutoDiaries };
