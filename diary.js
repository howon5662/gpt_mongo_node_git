// 📁 diary.js
const OpenAI = require("openai");
const { MongoClient } = require("mongodb");
const { classifyEmotionToThreeLevel } = require("./emojiEmotion"); // ✅ 추가
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const diaryClient = new MongoClient(process.env.MONGODB_URI);
const diaryDbName = "gpt_project";

// ✅ UTC → KST 자정 기준 날짜만 남기는 함수
function getKSTDateOnly(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000); // UTC → KST 변환
  return new Date(kst.getFullYear(), kst.getMonth(), kst.getDate()); // KST 기준 자정 시간
}

async function generateDiarySinceLast(userId, diaryDate = null) {
  await diaryClient.connect();
  const db = diaryClient.db(diaryDbName);
  const diaryCol = db.collection("diary");

  // 📌 마지막 일기 이후 시간
  const lastDiary = await diaryCol.find({ user_id: userId })
    .sort({ diaryDate: -1 })
    .limit(1)
    .toArray();

  const startTime = lastDiary[0]?.diaryDate || new Date(0);
  const now = new Date();

  // 📌 일기 대상 대화 조회 종료 시점
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

  // 📌 메타데이터 추출
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

  // 🧠 대표 감정 추출 (마지막 일기 이후 감정 리스트 중 하나만 추출)
  const emotionList = metadata.filter(m => m.role === "emotion").map(m => m.content);
  const finalEmotion = emotionList[0] ?? "보통"; // 하나라도 없으면 "보통" 대체

  // ✅ GPT에게 3단계 감정 분류 요청
  const emojiEmotion = await classifyEmotionToThreeLevel(finalEmotion);

  // ✅ KST 기준으로 저장할 일기 날짜 결정
  const diaryDateToSave = diaryDate ?? getKSTDateOnly();

  // ✅ 중복 저장 방지
  const alreadyExists = await diaryCol.findOne({
    user_id: userId,
    diaryDate: diaryDateToSave
  });
  if (alreadyExists) {
    console.log(`🔁 ${userId}의 ${diaryDateToSave.toISOString().slice(0, 10)} 일기 이미 존재, 건너뜀`);
    return;
  }

  // ✅ 최종 저장
  await diaryCol.insertOne({
    user_id: userId,
    diary: diaryText,
    emotion: emojiEmotion, // ← "긍정", "보통", "부정" 중 하나
    diaryDate: diaryDateToSave
  });

  console.log(`📓 ${userId}의 일기 저장 완료 (${diaryDateToSave.toISOString().slice(0, 10)})`);
}

module.exports = { generateDiarySinceLast };
