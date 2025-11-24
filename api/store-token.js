import { connectToDB } from "../utils/mongodb.js";

export default async function handler(req, res) {
  const token = req.query.token;
  if (!token) {
    res.status(400).send("Missing token.");
    return;
  }

  const db = await connectToDB();
  const tokens = db.collection("tokens");

  await tokens.insertOne({
    token,
    createdAt: new Date(),
    expireAt: new Date(Date.now() + 60 * 1000),
  });

  await tokens.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });

  res.status(204).end();
}
