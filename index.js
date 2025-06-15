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

  // 자동 등록 (처음 대화 시)
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
        content:
          `다음 발화에서 아래 항목만 JSON 배열로 추출해:\n` +
          `- emotion\n- condition\n- 한 일\n- favorite\n- hate\n-routine\n- prompt\n\n` +
          '- "emotion"은 user의 현재 감정적인 상태를 말해.\n' +
          '- "condition"은 user의 신체적인 상태를 말해. 예: "피곤함", "팔팔함"\n' +
          '- "한 일"은 user가 오늘 한 행동.\n' +
          '- "favorite"은 user가 좋아하는 것.\n' +
          '- "hate"는 user가 싫어하는 것.\n' +
          '- "routine"은 자주 반복하는 행동.\n' +
          '- 사용자가 일기 작성을 요청할 경우엔 "diary"로 요약해서 DB에 저장하면돼. 사용자한테 일기내용을 답변하지 마.\n' +
          '- "prompt"는 "~말투로", "밈 사용해줘" 등 말투 요구\n\n' +
          `📌 반드시 JSON 배열([])만 출력해. 설명 없이.\n` +
          `📌 형식: { "role": "...", "content": "..." }\n\n` +
          `사용자 발화:\n${userMessage}`,
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

// ✅ system prompt 생성
function buildSystemPrompt(metadata) {
  let traits = [];

  if (metadata.prompt && metadata.prompt.content)
    traits.push(metadata.prompt.content);
  if (metadata.favorite.length > 0)
    traits.push(`사용자는 ${metadata.favorite[0].content}을(를) 좋아해`);
  if (metadata.emotion.length > 0)
    traits.push(`오늘 감정은 ${metadata.emotion[0].content}`);

  return traits.length > 0
    ? `넌 지금 ${traits.join(", ")} 스타일로 대답하는 AI야.`
    : `넌 사용자와 친근하게 대화하는 AI야.`;
}

// ✅ 요약 생성 함수
async function summarizeHistory(history, tone = "기본") {
  const messages = [
    {
      role: "system",
      content: `너는 사용자의 하루를 요약해주는 따뜻한 AI야. 말투는 "${tone}" 스타일이야. 대화 내용을 바탕으로 하루를 요약해서 일기를 작성해줘.`,
    },
    ...history.map(([role, content]) => ({ role, content })),
  ];

  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
  });

  return res.choices[0].message.content;
}

module.exports = {
  chatWithContext,
  summarizeHistory,
};
