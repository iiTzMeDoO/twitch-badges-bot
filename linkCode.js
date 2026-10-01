// يستدعي api/join_callback (POST) بالموقع لما حد يكتب "!link <code>" بشات
// قناة البوت — "الطريقة الثانية" لإضافة البوت (بدون تسجيل دخول بتويتش،
// بس كود مؤقت). محمي بسر مشترك BOT_LINK_SECRET (نفس القيمة لازم تكون
// مضبوطة بمتغيرات بيئة الموقع بـ Vercel وبمتغيرات بيئة البوت).

const fetch = require("node-fetch");

async function confirmLinkCode(confirmUrl, secret, { code, login, broadcasterId }) {
  if (!confirmUrl) {
    return { ok: false, error: "ناقص joinCodeConfirmUrl بإعدادات البوت (config.json)" };
  }
  if (!secret) {
    return { ok: false, error: "ناقص BOT_LINK_SECRET بمتغيرات بيئة البوت" };
  }

  try {
    const resp = await fetch(confirmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Secret": secret,
      },
      body: JSON.stringify({ code, login, broadcasterId }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      return { ok: false, error: data.error || `HTTP ${resp.status}` };
    }
    return { ok: true, login: data.login || login };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { confirmLinkCode };
