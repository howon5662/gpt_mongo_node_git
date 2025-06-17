// 📁 index.js
const OpenAI = require("openai");
const { MongoClient } = require("mongodb");
const { getUserContext } = require("./context");
const { cleanOldMetadata } = require("./cleanup");
const { generateDiarySinceLast } = require("./diary");
const axios = require("axios");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const client = new MongoClient(process.env.MONGODB_URI);
const dbName = "gpt_project";

// ✅ RAG 응답
async function retrieveRAGResponse(userMessage) {
  try {
    const res = await axios.post("http://localhost:8000/rag", {
      query: userMessage,
    });
    return {
      ragResult: res.data.response,
      docs: res.data.related_texts,
    };
  } catch (err) {
    console.error("❌ RAG 호출 실패:", err.message);
    return { ragResult: "", docs: [] };
  }
}

// ✅ 채팅 처리
async function chatWithContext(userId, userMessage) {
  const db = client.db(dbName);

  await db.collection("users").updateOne(
    { user_id: userId },
    { $setOnInsert: { user_id: userId, created_at: new Date() } },
    { upsert: true }
  );

  const { messages, metadata } = await getUserContext(userId);
  const systemPrompt = buildSystemPrompt(metadata);

  const gptMessages = [
    { role: "system", content: systemPrompt },
    ...messages,
    { role: "user", content: userMessage },
  ];

  const extracted = await extractMetadataWithGPT(userMessage);

  const hasPromptStyle = extracted.some(
    (msg) =>
      msg.role === "prompt" &&
      (msg.content.includes("사투리") || msg.content.includes("밈"))
  );

  let gptResponse, docs;

  if (hasPromptStyle) {
    const { ragResult, docs: ragDocs } = await retrieveRAGResponse(userMessage);
    gptResponse = ragResult;
    docs = ragDocs;
  } else {
    const response = await openai.chat.completions.create({
      model: "ft:gpt-4o-2024-08-06:team::Bg7G2QnF",
      messages: gptMessages,
    });
    gptResponse = response.choices?.[0]?.message?.content ?? "(응답 없음)";
    docs = [];
  }

  await db.collection("conversations").insertOne({
    user_id: userId,
    messages: [
      { role: "user", content: userMessage },
      ...extracted,
      { role: "assistant", content: gptResponse },
    ],
    updated_at: new Date(),
    docs: docs,
  });

  console.log("🧠 GPT 응답:", gptResponse);

  const wantsDiary = extracted.some(
    (msg) => msg.role === "prompt" && msg.content.includes("일기")
  );

  if (wantsDiary || /일기.*(써|작성)/.test(userMessage)) {
    await generateDiarySinceLast(userId);
  }

  return gptResponse;
}

// ✅ 메타데이터 추출
async function extractMetadataWithGPT(userMessage) {
  const res = await openai.chat.completions.create({
    model: "ft:gpt-4o-2024-08-06:team::Bg7G2QnF",
    messages: [
      {
        role: "system",
        content: `
넌 사용자 발화로부터 감정, 상태, 말투를 정밀하게 추출하는 AI야.

다음 발화에서 아래 항목만 JSON 배열로 추출해:
- emotion
- condition
- 한 일
- favorite
- hate
- routine
- prompt

- 너는 감정과 행동을 유추하는 능력이 뛰어난 AI야
- "emotion"은 user의 현재 감정적인 상태를 말해.
- "condition"은 user의 신체적인 상태를 말해. 예: "피곤함", "팔팔함"
- "한 일"은 user가 오늘 한 행동.
- "favorite"은 user가 좋아하는 것.
- "hate"는 user가 싫어하는 것.
- "routine"은 자주 반복하는 행동.
- 사용자가 일기 작성을 요청할 경우엔 "diary"로 요약해서 DB에 저장하면돼. 사용자한테 일기내용을 답변하지 마.

- 암시적인 표현도 분석해.
  예: "쪽팔렸어" → emotion: 부끄러움,민망함,짜증남
      "비 맞고 넘어졌어" → 한 일: 넘어짐 + condition: 아픔

- "prompt"는 "귀여운 말투","츤데레 말투","시크한 말투","집착하는 말투","집사 말투", "사투리", "밈 사용해줘" 등 말투 요구

- 사용자가 직접적인 표현을 하지 않아도 추론해.
  예: "재밌게 말해줘" → prompt: "밈 사용"
      "요즘 츤데레 느낌 좋아" → prompt: "츤데레 말투"
      "부드럽게 말해줘" → prompt: "따뜻한 말투"

📌 반드시 JSON 배열([])만 출력해. 설명 없이.
📌 형식: { "role": "...", "content": "..." }

사용자 발화:
${userMessage}
        `.trim()
      },
    ],
  });

  const raw = res.choices[0].message.content.trim();
  console.log("📤 GPT 추출 응답 원본:", raw);

  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]") + 1;
    const jsonText = raw.substring(start, end);
    const parsed = JSON.parse(jsonText);
    const allowedRoles = ["emotion", "condition", "한 일", "favorite", "prompt", "hate", "routine"];
    return parsed.filter((msg) => allowedRoles.includes(msg.role));
  } catch (e) {
    console.warn("❌ JSON 파싱 실패:", raw);
    return [];
  }
}


// ✅ 하루 요약 일기 생성
async function summarizeHistory(history, tone = "기본") {
  const messages = [
    {
      role: "system",
      content: `너는 사용자의 하루를 요약해주는 따뜻한 AI야. 말투는 "${tone}" 스타일이야. 대화 내용을 바탕으로 하루를 요약해서 일기를 작성해줘.`,
    },
    ...history.map(([role, content]) => ({ role, content })),
  ];

  const res = await openai.chat.completions.create({
    model: "ft:gpt-4o-2024-08-06:team::Bg7G2QnF",
    messages,
  });

  return res.choices[0].message.content;
}

// ✅ 내보내기
module.exports = {
  chatWithContext,
  summarizeHistory,
  classifyEmotionToThreeLevel
};
