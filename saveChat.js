const { MongoClient } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
const dbName = "gpt_project"; // 너가 쓰던 DB 이름

// 메타데이터를 자동으로 파싱하는 함수
function extractMetadata(userMessage) {
  const metadata = [];

  // 감정 키워드 감지
  if (userMessage.includes("피곤")) metadata.push({ role: "emotion", content: "피곤" });
  if (userMessage.includes("슬퍼")) metadata.push({ role: "emotion", content: "슬픔" });
  if (userMessage.includes("고마워")) metadata.push({ role: "emotion", content: "고마움" });

  // 컨디션 키워드
  if (userMessage.includes("기운이 없어")) metadata.push({ role: "condition", content: "기운 없음" });

  // 루틴 예시 (시간 파싱은 더 정교하게 가능)
  if (userMessage.includes("6시에 일어나")) metadata.push({ role: "routine", content: "06:00 기상" });

  // 취향 키워드
  if (userMessage.includes("커피")) metadata.push({ role: "favorite", content: "커피" });

  // 말투/프롬프트
  const promptList = [];
  if (userMessage.includes("츤데레")) promptList.push("츤데레 말투");
  if (userMessage.includes("밈")) promptList.push("밈 사용");
  if (promptList.length > 0) metadata.push({ role: "prompt", content: promptList });

  return metadata;
}

async function saveChatToMongo(userId, userMessage, gptMessage) {
  const metadata = extractMetadata(userMessage);

  const document = {
    user_id: userId,
    messages: [
      { role: "user", content: userMessage },
      ...metadata,
      { role: "assistant", content: gptMessage }
    ],
    updated_at: new Date()
  };

  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection("conversations");

  await collection.insertOne(document);
  console.log("✅ 대화 저장 완료");
  await client.close();
}

module.exports = saveChatToMongo;
