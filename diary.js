// 📁 diary.js
const OpenAI = require("openai");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const diaryClient = new MongoClient(process.env.MONGODB_URI);
const diaryDbName = "gpt_project";

async function generateDiarySinceLast(userId) {
  await diaryClient.connect();
  const db = diaryClient.db(diaryDbName);

  const diaryCol = db.collection("diary");
  const lastDiary = await diaryCol.find({ user_id: userId })
    .sort({ created_at: -1 })
    .limit(1)
    .toArray();

  const startTime = lastDiary[0]?.created_at || new Date(0);
  const now = new Date();

  const convCol = db.collection("conversations");
  const docs = await convCol.find({
    user_id: userId,
    updated_at: { $gt: startTime, $lt: now }
  }).sort({ updated_at: 1 }).toArray();

  if (docs.length === 0) {
    console.log("❌ 일기 작성할 대화 없음");
    return;
  }

  const metadata = [];
  docs.forEach(doc => {
    doc.messages.forEach(msg => {
      if (["emotion", "condition", "한 일"].includes(msg.role)) {
        metadata.push(msg);
      }
    });
  });

  const diaryPrompt = [
    {
      role: "system",
      content: `다음은 사용자의 하루 요약 정보야. 이를 바탕으로 감정과 컨디션을 반영한 짧은 일기 세 줄을 써줘. 말투는 자연스럽고 따뜻하게 부탁해.`
    },
    {
      role: "user",
      content: `메타데이터 목록: ${JSON.stringify(metadata, null, 2)}`
    }
  ];

  const res = await openai.chat.completions.create({
    model: "ft:gpt-4o-2024-08-06:team:test-sum-hs-4:BbRa52lZ",
    messages: diaryPrompt
  });

  const diaryText = res.choices[0].message.content;
  await diaryCol.insertOne({
    user_id: userId,
    diary: diaryText,
    created_at: now
  });

  console.log("\n📓 일기 작성 완료:\n", diaryText);
}

module.exports = { generateDiarySinceLast };
