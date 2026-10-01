// سكريبت يشغّل مرة وحدة بس: باش تسجل دخول Twitch بحساب البوت
// (badgecollectorsxx) وتاخد منه access_token + refresh_token اللي
// البوت يحتاجهم باش يكتب بالشات ويجدد نفسه تلقائياً.
//
// الاستخدام:
//   1. عبي .env (شوف .env.example)
//   2. node get-bot-token.js
//   3. افتح الرابط اللي يطبعه بالمتصفح، وسجل دخول بحساب البوت (badgecollectorsxx)
//   4. بعد الموافقة، السكريبت يحفظ tokens.json تلقائياً ويوقف

require("dotenv").config();
const http = require("http");
const { URL } = require("url");
const fetch = require("node-fetch");
const fs = require("fs");

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI = process.env.TWITCH_REDIRECT_URI || "http://localhost:3000/callback";

// chat:read + chat:edit = صلاحيات كافية باش يقرا ويكتب بالشات عبر IRC (tmi.js)
// user:read:moderated_channels = تخلي البوت يتأكد بنفسه وش القنوات اللي
// هو مود فيها فعلاً (ضرورية لو الشات وضع "متابعين فقط" — بدون هالتأكد
// ما فيه طريقة نعرف ليش رسالة ما وصلت بصمت)
const SCOPES = ["chat:read", "chat:edit", "user:read:moderated_channels"].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ ناقص TWITCH_CLIENT_ID أو TWITCH_CLIENT_SECRET بملف .env");
  process.exit(1);
}

const authorizeUrl =
  "https://id.twitch.tv/oauth2/authorize" +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(SCOPES)}`;

console.log("\n=== خطوة 1: افتح هذا الرابط بالمتصفح وسجل دخول بحساب البوت ===\n");
console.log(authorizeUrl);
console.log("\nبانتظار الموافقة...\n");

const port = new URL(REDIRECT_URI).port || 3000;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (url.pathname !== new URL(REDIRECT_URI).pathname) {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error_description");

  if (error) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h2>فشل التسجيل: ${error}</h2>`);
    console.error("❌", error);
    server.close();
    return;
  }

  try {
    const tokenResp = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });
    const tokenData = await tokenResp.json();

    if (!tokenResp.ok) {
      throw new Error(JSON.stringify(tokenData));
    }

    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      // نحط وقت انتهاء تقريبي (ثواني) باش bot.js يعرف يجدد قبل ما ينتهي
      expires_at: Date.now() + tokenData.expires_in * 1000,
    };
    fs.writeFileSync(
      require("path").join(__dirname, "tokens.json"),
      JSON.stringify(tokens, null, 2)
    );

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>تم بنجاح ✅ رجّع لتيرمينال، البوت جاهز يشتغل. تقدر تسكر هذا التاب.</h2>");
    console.log("✅ تم حفظ tokens.json — تقدر دابا تشغل: npm start");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>صار خطأ، شوف التيرمينال</h2>");
    console.error("❌ فشل تبديل الكود بتوكن:", err.message);
  } finally {
    server.close();
  }
});

server.listen(port, () => {
  console.log(`(سيرفر محلي شغال على المنفذ ${port} بانتظار رد Twitch...)`);
});
