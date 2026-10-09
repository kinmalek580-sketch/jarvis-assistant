const http = require("http");
const https = require("https");
require("dotenv").config();

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const MAX_BODY_BYTES = 16 * 1024;

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function callOpenAI(message) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: MODEL,
      input: [
        {
          role: "system",
          content: "You are JARVIS, a helpful, clear, friendly personal AI assistant. Be honest about uncertainty and never claim to have performed a device action unless it actually happened."
        },
        { role: "user", content: message }
      ],
      max_output_tokens: 500
    });

    const req = https.request({
      hostname: "api.openai.com",
      path: "/v1/responses",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(data); }
        catch { return reject(new Error("AI service returned an unreadable response")); }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = parsed.error?.message || `AI service error (${res.statusCode})`;
          return reject(new Error(message));
        }

        const reply = (parsed.output || [])
          .flatMap(item => item.content || [])
          .filter(item => item.type === "output_text")
          .map(item => item.text || "")
          .join("\n")
          .trim();

        resolve(reply || "I couldn't produce a response this time.");
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error("AI request timed out")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, mode: API_KEY ? "ai" : "demo" });
  }

  if (req.method === "POST" && url.pathname === "/chat") {
    try {
      const body = await readJson(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) return sendJson(res, 400, { error: "Please provide a message." });
      if (message.length > 4000) return sendJson(res, 413, { error: "Message is too long (maximum 4000 characters)." });

      if (!API_KEY || API_KEY === "replace_with_your_own_key") {
        return sendJson(res, 200, {
          reply: `Demo backend received: "${message}". Add your API key to backend/.env to enable real AI.`
        });
      }

      const reply = await callOpenAI(message);
      return sendJson(res, 200, { reply });
    } catch (err) {
      console.error("Request failed:", err.message);
      return sendJson(res, 500, { error: "The request failed. Check server settings and logs." });
    }
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`JARVIS backend listening on port ${PORT}`);
  console.log(`Mode: ${API_KEY ? "AI (API usage may cost money)" : "demo (no API key)"}`);
  console.log("Development prototype only. Do not expose this server directly to the public internet.");
});
