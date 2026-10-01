// بيتأكد فعلياً (عن طريق Twitch Helix API، مو افتراضاً) وش القنوات
// اللي حساب البوت "مشرف" (مود) فيها فعلاً. هذا مهم لأن لو الشات وضع
// "متابعين فقط" (followers-only) أو "مشتركين فقط"، أي حساب مو مود ولا
// برودكاستر ما يقدر يكتب أبداً — والـ IRC ما يرجع أي خطأ واضح، الرسالة
// توصل بصمت. فبدل ما نفترض إن التمويد التلقائي (عند api/join_callback)
// نجح دايماً، البوت يتأكد بنفسه ويحذر لو لقى قناة مفعّل فيها التنبيهات
// وهو مو مود فيها.
//
// يحتاج توكن حساب البوت نفسه بصلاحية user:read:moderated_channels
// (لازم تضيفها بـ get-bot-token.js وتعيد تسجيل الدخول لو التوكن الحالي
// ما فيها هالصلاحية).

const fetch = require("node-fetch");

async function getSelfUserId(clientId, accessToken) {
  const resp = await fetch("https://api.twitch.tv/helix/users", {
    headers: { "Client-Id": clientId, Authorization: `Bearer ${accessToken}` },
  });
  const data = await resp.json();
  if (!resp.ok || !data.data || !data.data[0]) {
    throw new Error(`فشل جلب هوية حساب البوت: ${JSON.stringify(data)}`);
  }
  return data.data[0].id;
}

// يرجع Set بأسماء (login، حروف صغيرة) كل القنوات اللي البوت مود فيها فعلياً
async function getModeratedChannelLogins(clientId, accessToken) {
  const selfId = await getSelfUserId(clientId, accessToken);
  const logins = new Set();
  let cursor = null;
  let pages = 0;

  do {
    const url = new URL("https://api.twitch.tv/helix/moderation/channels");
    url.searchParams.set("user_id", selfId);
    url.searchParams.set("first", "100");
    if (cursor) url.searchParams.set("after", cursor);

    const resp = await fetch(url, {
      headers: { "Client-Id": clientId, Authorization: `Bearer ${accessToken}` },
    });
    const data = await resp.json();
    if (!resp.ok) {
      // لو التوكن ناقصه الصلاحية (user:read:moderated_channels)، ما نكسر
      // البوت — بس نطلع خطأ واضح للي يشغله يشوفه بالـ log
      throw new Error(`فشل التحقق من قنوات الإشراف: ${JSON.stringify(data)}`);
    }
    for (const ch of data.data || []) {
      if (ch.broadcaster_login) logins.add(ch.broadcaster_login.toLowerCase());
    }
    cursor = data.pagination && data.pagination.cursor;
    pages += 1;
  } while (cursor && pages < 10);

  return logins;
}

module.exports = { getModeratedChannelLogins, getSelfUserId };
