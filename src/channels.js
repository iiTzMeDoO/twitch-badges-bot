// يجيب قائمة القنوات اللي انضافت من الموقع (زر "أضف البوت لقناتك" →
// api/join_start → api/join_callback يسجلها بـ Firestore) عن طريق
// endpoint عام: api/bot_channels. ما يحتاج أي مفتاح — قراءة عامة فقط.

const fetch = require("node-fetch");

async function fetchDynamicChannels(channelsApiUrl) {
  if (!channelsApiUrl) return [];
  const resp = await fetch(channelsApiUrl, {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!resp.ok) {
    throw new Error(`فشل جلب قائمة القنوات: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const list = Array.isArray(data.channels) ? data.channels : [];
  // نتأكد كل عنصر عنده login نظيف، ونحط قيم افتراضية للإعدادات
  return list
    .filter((c) => c && typeof c.login === "string" && c.login.trim())
    .map((c) => ({
      login: c.login.trim().toLowerCase(),
      newBadgeAlerts: c.newBadgeAlerts !== false,
    }));
}

// يجيب أوامر البث بالانتظار (رسالة كتبتها لوحة التحكم بالموقع) عن طريق
// نفس endpoint القنوات، بس ?action=pending_commands. الطلب هذا يمسح
// الأوامر من Firestore فور قراءتها (استهلاك لمرة وحدة).
async function fetchPendingBroadcasts(channelsApiUrl) {
  if (!channelsApiUrl) return [];
  const url = `${channelsApiUrl}${channelsApiUrl.includes("?") ? "&" : "?"}action=pending_commands`;
  const resp = await fetch(url, { headers: { "Cache-Control": "no-cache" } });
  if (!resp.ok) {
    throw new Error(`فشل جلب أوامر البث: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  return Array.isArray(data.commands) ? data.commands : [];
}

module.exports = { fetchDynamicChannels, fetchPendingBroadcasts };
