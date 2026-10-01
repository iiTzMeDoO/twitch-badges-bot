// إدارة توكن حساب البوت: قراءة/حفظ tokens.json وتجديد access_token
// تلقائياً عن طريق refresh_token قبل ما ينتهي.

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const TOKENS_PATH = path.join(__dirname, "..", "tokens.json");

function loadTokens() {
  if (fs.existsSync(TOKENS_PATH)) {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
  }
  // ماكاش tokens.json (طبيعي على منصات زي Render لو ما رفعناه بالمستودع
  // عمداً لأسباب أمان) — نجرب نبنيه من متغيرات بيئة بدالها. تنسخ القيم
  // مرة وحدة من tokens.json المحلي لعندك وتحطها كمتغيرات بيئة بلوحة
  // تحكم المنصة: TWITCH_BOT_ACCESS_TOKEN و TWITCH_BOT_REFRESH_TOKEN
  const envAccess = process.env.TWITCH_BOT_ACCESS_TOKEN;
  const envRefresh = process.env.TWITCH_BOT_REFRESH_TOKEN;
  if (envAccess && envRefresh) {
    const tokens = { access_token: envAccess, refresh_token: envRefresh, expires_at: 0 };
    saveTokens(tokens);
    return tokens;
  }
  throw new Error(
    "ماكاش tokens.json ولا متغيرات TWITCH_BOT_ACCESS_TOKEN/TWITCH_BOT_REFRESH_TOKEN — لازم تشغل الأمر أولاً: npm run get-token"
  );
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

async function refreshAccessToken(clientId, clientSecret) {
  const tokens = loadTokens();
  const resp = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error("فشل تجديد توكن البوت: " + JSON.stringify(data));
  }
  const newTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveTokens(newTokens);
  return newTokens;
}

// يرجع access_token صالح للاستخدام — يجدده تلقائياً لو باقيلو أقل من 10 دقايق
async function getValidAccessToken(clientId, clientSecret) {
  let tokens = loadTokens();
  const tenMinutes = 10 * 60 * 1000;
  if (!tokens.expires_at || Date.now() > tokens.expires_at - tenMinutes) {
    tokens = await refreshAccessToken(clientId, clientSecret);
  }
  return tokens.access_token;
}

module.exports = { loadTokens, saveTokens, refreshAccessToken, getValidAccessToken };
