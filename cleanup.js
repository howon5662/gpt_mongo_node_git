// 📁 cleanup.js
const { MongoClient: Mongo } = require("mongodb");
require("dotenv").config();

const cleanupClient = new Mongo(process.env.MONGODB_URI);
const cleanupDbName = "gpt_project";

async function cleanOldMetadata(userId) {
  await cleanupClient.connect();
  const db = cleanupClient.db(cleanupDbName);
  const collection = db.collection("conversations");

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const docs = await collection.find({ user_id: userId }).toArray();

  for (const doc of docs) {
    const filtered = doc.messages.filter(msg => {
      if (["emotion", "condition", "한 일"].includes(msg.role) && doc.updated_at < cutoff) {
        return false;
      }
      return true;
    });

    if (filtered.length !== doc.messages.length) {
      await collection.updateOne(
        { _id: doc._id },
        { $set: { messages: filtered } }
      );
    }
  }

  console.log("🧹 오래된 emotion/condition/한 일 삭제 완료");
}

module.exports = { cleanOldMetadata };
