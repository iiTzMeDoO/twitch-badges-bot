// إدارة توكن حساب البوت: قراءة/حفظ tokens.json وتجديد access_token
// تلقائياً عن طريق refresh_token قبل ما ينتهي.

const fs = require("fs");
const path = require("path");

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

function saveTokens(tokens) {
    try {
        fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
    } catch (err) {
        console.log("تعذر حفظ الملف على نظام الملفات المؤقت (سيتم الاعتماد على البيئة الحالية).");
    }
}

async function refreshAccessToken(clientId, clientSecret) {
    const tokens = loadTokens();

    if (!clientId || !clientSecret || !tokens.refresh_token) {
        return tokens;
    }

    try {
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
            console.log("تعذر تجديد التوكن عبر Twitch API، سيتم استخدام التوكن الحرفي الحالي:", data.message || data);
            return tokens;
        }

        const newTokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token || tokens.refresh_token,
            expires_at: Date.now() + (data.expires_in || 3600) * 1000,
        };

        saveTokens(newTokens);
        return newTokens;
    } catch (err) {
        console.log("خطأ أثناء تجديد التوكن، سيتم الاستمرار بالتوكن المباشر:", err.message);
        return tokens;
    }
}

// يرجع access_token صالح للاستخدام
async function getValidAccessToken() {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (clientId && clientSecret) {
        const updatedTokens = await refreshAccessToken(clientId, clientSecret);
        return updatedTokens.access_token;
    }

    const tokens = loadTokens();
    return tokens.access_token;
}

module.exports = { loadTokens, saveTokens, refreshAccessToken, getValidAccessToken };
