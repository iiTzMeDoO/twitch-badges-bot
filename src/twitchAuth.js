// إدارة توكن حساب البوت: قراءة/حفظ tokens.json وتجديد access_token
// تلقائياً عن طريق refresh_token قبل ما ينتهي.

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const TOKENS_PATH = path.join(__dirname, "..", "tokens.json");

function loadTokens() {
    // استخدام التوكن المباشر المضاف في Railway
    const accessToken = process.env.TWITCH_BOT_ACCESS_TOKEN || process.env.TWITCH_OAUTH_TOKEN;
    const refreshToken = process.env.TWITCH_BOT_REFRESH_TOKEN || process.env.TWITCH_OAUTH_TOKEN;

    if (!accessToken) {
        throw new Error("لم يتم العثور على توكن Twitch في متغيرات البيئة!");
    }

    return {
        access_token: accessToken.replace(/^oauth:/, ''),
        refresh_token: refreshToken ? refreshToken.replace(/^oauth:/, '') : ''
    };
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
