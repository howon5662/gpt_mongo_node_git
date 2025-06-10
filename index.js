const OpenAI = require("openai");
const { MongoClient } = require("mongodb");
const { getUserContext } = require("./context");
const { cleanOldMetadata } = require("./cleanup");
const { generateDiarySinceLast } = require("./diary");
const axios = require("axios"); // FastAPI 호출용

require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const client = new MongoClient(process.env.MONGODB_URI);
const dbName = "gpt_project";

// 👉 RAG 응답 요청 함수
async function retrieveRAGResponse(userMessage) {
  try {
    const res = await axios.post("http://localhost:8000/rag", {
      query: userMessage
    });

    const ragResult = res.data.response;
    const docs = res.data.related_texts;

    console.log("📚 RAG 문서:", docs);
    console.log("💬 RAG 응답:", ragResult);

    return { ragResult, docs };
  } catch (err) {
    console.error("❌ RAG 호출 실패:", err.message);
    return { ragResult: "", docs: [] };
  }
}

async function chatWithContext(userId, userMessage) {
  const db = client.db(dbName);

  // ✅ 사용자 자동 등록 (없을 경우에만)
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
    { role: "user", content: userMessage }
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
      messages: gptMessages
    });
    gptResponse = response.choices?.[0]?.message?.content ?? "(응답 없음)";
    docs = [];
  }

  const collection = db.collection("conversations");
  await collection.insertOne({
    user_id: userId,
    messages: [
      { role: "user", content: userMessage },
      ...extracted,
      { role: "assistant", content: gptResponse }
    ],
    updated_at: new Date(),
    docs: docs
  });

  console.log("\n🧠 GPT 응답:", gptResponse);
  console.log("✅ 저장 완료");

  const wantsDiary = extracted.some(
    msg => msg.role === "prompt" && msg.content.includes("일기")
  );

  if (wantsDiary || /일기.*(써|작성)/.test(userMessage)) {
    await generateDiarySinceLast(userId);
  }

  return gptResponse;
}

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
            '- "condition"은 user의 신체적인 상태를 말해. 예를 들어 "숙취 있음", "피곤함", "아픔", "멀쩡함", "팔팔함"\n' +
            '- "한 일"은 user가 그 날에 무엇을 했는지를 말해. 예를 들어 "술 마심", "영화 시청", "독서", "요가", "운동", "약 먹음", "친구랑 카페 감" \n' +
            '- "favorite"은 user가 좋아하는 것들을 말해. 더이상 좋아하지 않는다고 말하면 "favorite"에서 삭제해야해. \n' +
            '- "hate"는 user가 싫어하는 것들을 말해. 이젠 싫어하지 않는다고 말하면 "hate"에서 삭제해야해.\n' +
            '- "routine"은 user의 습관이나 자주하는 행동들을 말해. 예를 들어 "아침 6시에 기상하기","일어나자마자 세수하기","학원숙제 미루기","슬픈 영화만 보면 울기"\n' +
            '- 답변만 해서 대화를 끝내기만 하면 안 되고, 대화 흐름에 맞게 질문도 자주 해야해.\n' +
            `📌 반드시 JSON 배열([])만 출력해. 설명 없이.\n` +
            `📌 각 항목은 { "role": "...", "content": "..." } 형식이어야 하고, role은 반드시 위에 제시한 5개 중 하나만 허용됨.\n` +
            `📌 절대 "user"나 "assistant" 역할은 포함하지 마.\n\n` +
            `- 예: "밈 사용해줘", "~말투로", "~처럼 말해줘"는 prompt로 간주해.\n` +
            '- user가 대화 도중 밈을 사용하는 경우, 같이 사용해야해.\n' +
            `- user가 명확하게 스타일을 요구한 경우 추출해.\n\n` +
            `사용자 발화:\n${userMessage}`
      }
    ]
  });

  const raw = res.choices[0].message.content.trim();
  console.log("📤 GPT 추출 응답 원본:", raw);

  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]") + 1;
    const jsonText = raw.substring(start, end);

    const parsed = JSON.parse(jsonText);
    const allowedRoles = ["emotion", "condition", "한 일", "favorite", "prompt", "hate", "routine"];
    const filtered = parsed.filter(msg => allowedRoles.includes(msg.role));

    return Array.isArray(filtered) ? filtered : [];
  } catch (e) {
    console.warn("❌ JSON 파싱 실패:", raw);
    return [];
  }
}

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

if (require.main === module) {
  (async () => {
    const userId = "user234";
    const userMessage = "좋은 아침! 퉁퉁퉁 사후르";

    await client.connect();
    await cleanOldMetadata(userId);
    await chatWithContext(userId, userMessage);
    process.exit(0);
  })();
}

module.exports = { chatWithContext };
