// 📁 context.js
const { MongoClient } = require("mongodb");
require("dotenv").config();

const client = new MongoClient(process.env.MONGODB_URI);
const dbName = "gpt_project";

async function getUserContext(userId) {
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection("conversations");

  const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const docs = await collection
    .find({ user_id: userId, updated_at: { $gte: since48h } })
    .sort({ updated_at: 1 })
    .toArray();

  const messages = [];
  const metadata = {
    emotion: [],
    condition: [],
    today_tasks: [],
    prompt: null,
    favorite: [],
    hate: [],
    routine: []
  };

  for (const doc of docs) {
    for (const msg of doc.messages) {
      if (["user", "assistant"].includes(msg.role)) {
        messages.push(msg);
      } else {
        const msgDate = new Date(doc.updated_at);
        const isToday = msgDate >= todayStart;

        switch (msg.role) {
          case "emotion":
            if (isToday) metadata.emotion.push(msg);
            break;
          case "condition":
            if (isToday) metadata.condition.push(msg);
            break;
          case "한 일":
            if (isToday) metadata.today_tasks.push(msg);
            break;
          case "prompt":
            metadata.prompt = msg;
            break;
          case "favorite":
            metadata.favorite.push(msg);
            break;
          case "hate":
            metadata.hate.push(msg);
            break;
          case "routine":
            metadata.routine.push(msg);
            break;
        }
      }
    }
  }

  return { messages, metadata };
}

module.exports = { getUserContext };
