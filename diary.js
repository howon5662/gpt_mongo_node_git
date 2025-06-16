// 📁 diary.js
const OpenAI = require("openai");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const diaryClient = new MongoClient(process.env.MONGODB_URI);
const diaryDbName = "gpt_project";

async function generateDiarySinceLast(userId, diaryDate = null) {
  await diaryClient.connect();
  const db = diaryClient.db(diaryDbName);
  const diaryCol = db.collection("diary");

  // 마지막 일기 이후 시간
  const lastDiary = await diaryCol.find({ user_id: userId })
    .sort({ diaryDate: -1 })
    .limit(1)
    .toArray();

  const startTime = lastDiary[0]?.diaryDate || new Date(0);
  const now = new Date();

  // 📅 일기 대상 날짜의 종료 시점 (23:59:59)
  const endTime = diaryDate
    ? new Date(diaryDate.getFullYear(), diaryDate.getMonth(), diaryDate.getDate(), 23, 59, 59, 999)
    : now;

  const convCol = db.collection("conversations");
  const docs = await convCol.find({
    user_id: userId,
    updated_at: { $gt: startTime, $lt: endTime }
  }).sort({ updated_at: 1 }).toArray();

  if (docs.length === 0) {
    console.log(`❌ ${userId} (${diaryDate?.toISOString().slice(0, 10) ?? "오늘"}) 일기 작성할 대화 없음`);
    return;
  }

  // 📌 감정 / 컨디션 / 한 일 메타데이터 추출
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

  // 🧠 감정 우선순위 계산
  const emotionList = metadata.filter(m => m.role === "emotion").map(m => m.content);
  const priority = { "우울": 1, "슬픔": 1, "피곤": 2, "불안": 2, "고마움": 3, "행복": 3, "보통": 4 };
  let finalEmotion = "보통";
  for (const e of emotionList) {
    if (!priority[finalEmotion] || (priority[e] && priority[e] < priority[finalEmotion])) {
      finalEmotion = e;
    }
  }

  // 📅 저장할 diaryDate 결정
  const diaryDateToSave = diaryDate ?? ((now.getHours() < 6 || (now.getHours() === 6 && now.getMinutes() === 0))
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate()));

  await diaryCol.insertOne({
    user_id: userId,
    diary: diaryText,
    emotion: finalEmotion,
    diaryDate: diaryDateToSave
  });

  console.log(`📓 ${userId}의 일기 저장 완료 (${diaryDateToSave.toISOString().slice(0, 10)})`);
}

module.exports = { generateDiarySinceLast };
