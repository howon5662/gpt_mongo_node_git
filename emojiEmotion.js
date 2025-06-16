// 📁 emojiEmotion.js
const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ 감정 단어 → "긍정/보통/부정" 3단계로 분류하는 함수
async function classifyEmotionToThreeLevel(finalEmotion) {
  const prompt = [
    {
      role: "system",
      content: `
넌 사용자의 감정 단어를 받아서 다음 셋 중 하나로 분류하는 AI야.
반드시 아래 중 하나로만 출력해:
- 긍정
- 보통
- 부정

설명 없이 감정 이름만 출력해. 예:
"행복" → 긍정
"짜증" → 부정
"피곤" → 보통
`.trim()
    },
    {
      role: "user",
      content: `감정 단어: ${finalEmotion}`
    }
  ];

  const res = await openai.chat.completions.create({
    model: "ft:gpt-4o-2024-08-06:team:test-sum-hs-4:BbRa52lZ",
    messages: prompt
  });

  return res.choices[0].message.content.trim();
}

module.exports = { classifyEmotionToThreeLevel };