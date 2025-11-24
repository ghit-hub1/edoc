export default function handler(req, res) {
  const token = req.query.token || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";

  console.log(
    JSON.stringify({
      event: "token_generated",
      timestamp: new Date().toISOString(),
      token,
      ip,
      userAgent: ua,
    })
  );

  res.status(204).end();
}
