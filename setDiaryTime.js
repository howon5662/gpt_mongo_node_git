const { MongoClient } = require("mongodb");
require("dotenv").config();

const client = new MongoClient(process.env.MONGODB_URI);
const dbName = "gpt_project";

// 사용법: node setDiaryTime.js user123 03:00
(async () => {
  const userId = process.argv[2];
  const diaryTime = process.argv[3]; // 예: "03:00"

  if (!userId || !diaryTime) {
    console.error("❗ 사용자 ID와 Diarytime을 함께 입력해주세요. 예: node setDiaryTime.js user123 03:00");
    process.exit(1);
  }

  await client.connect();
  const db = client.db(dbName);
  const settings = db.collection("user_settings");

  await settings.updateOne(
    { user_id: userId },
    { $set: { Diarytime: diaryTime } },
    { upsert: true }
  );

  console.log(`✅ ${userId}의 Diarytime을 ${diaryTime}으로 설정했습니다.`);
  process.exit(0);
})();
