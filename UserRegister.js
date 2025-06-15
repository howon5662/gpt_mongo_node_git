const { MongoClient } = require("mongodb");
const bcrypt = require("bcrypt");
require("dotenv").config();

const client = new MongoClient(process.env.MONGODB_URI);
const dbName = "gpt_project";

async function registerUser(userId, password) {
  await client.connect();
  const db = client.db(dbName);
  const users = db.collection("users");

  const exists = await users.findOne({ user_id: userId });
  if (exists) {
    console.log("❌ 이미 등록된 사용자입니다.");
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10); // 솔트 라운드 10
  await users.insertOne({
    user_id: userId,
    password: hashedPassword,
    created_at: new Date()
  });

  console.log("✅ 사용자 등록 완료 (해시 저장됨)");
}

if (require.main === module) {
  const userId = process.argv[2];
  const password = process.argv[3];

  if (!userId || !password) {
    console.error("❗ 사용자 ID와 비밀번호를 입력해주세요.");
    process.exit(1);
  }

  registerUser(userId, password).then(() => process.exit(0));
}
