require("dotenv").config();
const fs = require("fs");
const path = require("path");
const tmi = require("tmi.js");

const { getValidAccessToken } = require("./src/twitchAuth");
const { fetchBadges, splitByStatus, badgeKey } = require("./src/badges");
const { loadAnnounced, saveAnnounced } = require("./src/state");
const { fetchDynamicChannels, fetchPendingBroadcasts } = require("./src/channels");
const { getModeratedChannelLogins } = require("./src/modStatus");
const { startKeepAliveServer } = require("./src/keepAlive");
const { confirmLinkCode } = require("./src/linkCode");

const CONFIG_PATH = path.join(__dirname, "config.json");
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const BOT_LINK_SECRET = process.env.BOT_LINK_SECRET;

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// حد Twitch لطول رسالة الشات تقريباً 500 حرف — نقسم إذا لزم
function chunkMessage(prefix, items, maxLen = 450) {
  const chunks = [];
  let current = prefix;
  for (const item of items) {
    const piece = (current === prefix ? "" : "، ") + item;
    if ((current + piece).length > maxLen) {
      chunks.push(current);
      current = prefix + item;
    } else {
      current += piece;
    }
  }
  if (current !== prefix) chunks.push(current);
  return chunks;
}

function isModOrBroadcaster(tags, channel) {
  const channelName = channel.replace("#", "").toLowerCase();
  const isBroadcaster =
    tags.badges && tags.badges.broadcaster === "1";
  const isMod = tags.mod === true || tags.mod === "1";
  return isBroadcaster || isMod || tags.username === channelName;
}

// كلمة "بادج؟" — قائمة كاملة بكل البادجات المتاحة الآن وقريبًا
function isBadgeListTrigger(message) {
  const cleaned = message.trim().replace(/[؟?!.]+$/g, "").trim();
  return cleaned === "بادج";
}

// كلمة "بادجات؟" — بس رابط الموقع (بدون قائمة)
function isBadgesLinkTrigger(message) {
  const cleaned = message.trim().replace(/[؟?!.]+$/g, "").trim();
  return cleaned === "بادجات";
}

// كلمة "بورد؟" / "board؟" — رابط صفحة العرض الحية (board.html) اللي
// تنحط كـ Browser Source بـ OBS أو تتبعث بأي مكان
function isBoardTrigger(message) {
  const cleaned = message.trim().toLowerCase().replace(/[؟?!.]+$/g, "").trim();
  return cleaned === "بورد" || cleaned === "board";
}

async function main() {
  startKeepAliveServer(); // مهم لو شغّال على Render أو منصة شبيهة — تجاهله لو محلي/VPS
  let config = loadConfig();
  const announced = loadAnnounced();
  const isFirstRun = !fs.existsSync(path.join(__dirname, "state.json"));

  // ملاحظة مهمة: getValidAccessToken تجدد التوكن تلقائياً (بالكتابة على
  // tokens.json) لو باقيلو أقل من 10 دقايق. المشكلة السابقة كانت إننا
  // نجيب accessToken هنا مرة وحدة بمتغير ثابت (const) ونستخدمه بكل
  // مكان — بعد ما توكن Twitch ينتهي (كل ~4 ساعات) يصير "Invalid OAuth
  // token" بكل استدعاء (فحص الإشراف) وتفصل جلسة IRC (فيفشل client.say
  // بصمت برسالة "undefined"). الحل: ما نخزن التوكن بمتغير ثابت أبداً —
  // كل مكان يحتاجه يجيبه تازة عن طريق getValidAccessToken().

  // ==========================================================
  // إدارة القنوات: القنوات الثابتة (config.json) + القنوات الديناميكية
  // (اللي انضافت من زر "أضف البوت لقناتك" بالموقع). كل قناة ديناميكية
  // إعداداتها بتتحفظ هنا بالذاكرة فقط (المصدر الحقيقي هو Firestore عن
  // طريق api/bot_channels)، وتنبيهات البادج الجديد مفعّلة افتراضياً.
  // ==========================================================
  const dynamicChannels = new Map(); // login -> { newBadgeAlerts }

  function allChannelLogins() {
    return new Set([
      ...Object.keys(config.channels),
      ...dynamicChannels.keys(),
    ]);
  }

  function getChannelSettings(channelName) {
    if (config.channels[channelName]) return config.channels[channelName];
    if (dynamicChannels.has(channelName)) return dynamicChannels.get(channelName);
    return { newBadgeAlerts: true };
  }

  const client = new tmi.Client({
    options: { debug: false },
    identity: {
      username: config.botUsername,
      // tmi.js يقبل password كدالة (sync أو async) ويعيد استدعاؤها بكل
      // إعادة اتصال (reconnect) — هذا يخلي البوت يستخدم توكن تازة/مجدد
      // دايماً بدل ما يعلق بتوكن قديم انتهت صلاحيته من أول اتصال.
      password: async () => `oauth:${await getValidAccessToken(CLIENT_ID, CLIENT_SECRET)}`,
    },
    channels: Object.keys(config.channels),
  });

  await client.connect();

  // إعادة اتصال دورية إجبارية (كل 3 ساعات، قبل انتهاء التوكن بـ4 ساعات)
  // عشان نضمن جلسة IRC تستخدم توكن مجدد دايماً، حتى لو Twitch ما قطع
  // الاتصال بنفسه وقت انتهاء التوكن.
  setInterval(async () => {
    try {
      await client.disconnect();
      await client.connect();
      console.log("🔄 تم تجديد اتصال IRC بتوكن تازة.");
    } catch (err) {
      console.error("❌ فشل تجديد اتصال IRC:", err.message);
    }
  }, 3 * 60 * 60 * 1000);
  console.log(`✅ البوت متصل ودخل: ${Object.keys(config.channels).join(", ")}`);

  // ==========================================================
  // مزامنة القنوات الديناميكية (اللي ربطوا بوتهم من الموقع)
  // ==========================================================
  async function syncDynamicChannels() {
    if (!config.channelsApiUrl) return;
    try {
      const list = await fetchDynamicChannels(config.channelsApiUrl);
      const seen = new Set();

      for (const c of list) {
        seen.add(c.login);
        const isNew = !dynamicChannels.has(c.login) && !config.channels[c.login];
        dynamicChannels.set(c.login, { newBadgeAlerts: c.newBadgeAlerts });

        if (isNew) {
          try {
            await client.join(c.login);
            await client.say(
              c.login,
              `👋 هلا! بوت البادجات دخل قناتكم — راح يعلن كل بادج جديد ينزل بالموقع تلقائياً، وأي حد يكتب "بادج؟" بالشات توصله قائمة كل البادجات المتاحة والقريبة، أو "بادجات؟" يوصله رابط الموقع مباشرة، و"بورد؟" يوصله رابط لوحة العرض الحية. الأوامر: !badgebot status`
            );
            console.log(`➕ انضمّ لقناة جديدة: ${c.login}`);
          } catch (err) {
            console.error(`❌ فشل الانضمام لقناة ${c.login}:`, err.message);
          }
        }
      }

      // أي قناة ديناميكية كانت موجودة وما عادتش بالقائمة (انشالت/الغت
      // الربط) نطلع منها
      for (const login of [...dynamicChannels.keys()]) {
        if (!seen.has(login)) {
          dynamicChannels.delete(login);
          try {
            await client.part(login);
            console.log(`➖ طلعنا من قناة: ${login}`);
          } catch (err) {
            console.error(`❌ فشل الخروج من قناة ${login}:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error("❌ خطأ مزامنة القنوات:", err.message);
    }
  }

  // ==========================================================
  // بث رسالة يدوية (من لوحة التحكم بالموقع) لكل القنوات المرتبطة —
  // نفس فكرة بث ديسكورد بالضبط بس لقنوات تويتش. لوحة التحكم تحط
  // الرسالة بطابور Firestore (عن طريق api/bot_channels.py
  // action=queue_broadcast)، وهذي الدالة تسحبها كل فترة وتنشرها
  // بكل قناة داخلها البوت (الثابتة + الديناميكية).
  // ==========================================================
  async function checkPendingBroadcasts() {
    try {
      const commands = await fetchPendingBroadcasts(config.channelsApiUrl);
      for (const cmd of commands) {
        if (cmd.type !== "broadcast" || !cmd.message) continue;
        const msg = `📣 ${cmd.message}`;
        for (const channelName of allChannelLogins()) {
          try {
            await client.say(channelName, msg);
          } catch (err) {
            console.error(`❌ فشل إرسال البث بقناة ${channelName}:`, err.message);
          }
        }
        console.log(`📣 تم بث رسالة لـ ${allChannelLogins().size} قناة.`);
      }
    } catch (err) {
      console.error("❌ خطأ فحص أوامر البث:", err.message);
    }
  }

  // ==========================================================
  // التحقق الحقيقي: هل البوت مشرف (مود) فعلاً بكل قناة داخلها؟ مهم لأن
  // القنوات اللي الشات فيها بوضع "متابعين فقط" ما تقبل رسايل من أي حد
  // مو مود أو برودكاستر — وIRC ما يرجع أي خطأ واضح، الرسالة توصل بصمت.
  // لو خطوة التمويد التلقائي (api/join_callback) فشلت لأي سبب، هذا
  // الفحص يكتشفها ويحذر بالقناة نفسها (مرة وحدة، مو بكل فحص).
  // ==========================================================
  const modWarned = new Set();
  async function checkModStatus() {
    try {
      const freshToken = await getValidAccessToken(CLIENT_ID, CLIENT_SECRET);
      const moderated = await getModeratedChannelLogins(CLIENT_ID, freshToken);
      for (const channelName of allChannelLogins()) {
        if (channelName === config.botUsername.toLowerCase()) continue; // قناة البوت نفسه، ما ينحسب "إشراف"
        if (moderated.has(channelName)) {
          modWarned.delete(channelName);
          continue;
        }
        if (modWarned.has(channelName)) continue;
        modWarned.add(channelName);
        console.warn(`⚠️ البوت مو مشرف (مود) بقناة ${channelName} فعلياً — لو الشات وضع "متابعين فقط" ما راح يقدر يكتب.`);
        try {
          await client.say(
            channelName,
            `⚠️ أنا مو مشرف (مود) بهالقناة بعد. لو الشات وضع "متابعين فقط" ما راح أقدر أكتب. اكتبوا /mod ${config.botUsername} عشان أشتغل بشكل كامل.`
          );
        } catch (err) {
          console.error(`❌ فشل إرسال تحذير المود بقناة ${channelName}:`, err.message);
        }
      }
    } catch (err) {
      console.error("❌ خطأ التحقق من حالة الإشراف (تأكدوا إن توكن البوت فيه صلاحية user:read:moderated_channels):", err.message);
    }
  }

  // ==========================================================
  // فحص البادجات الجديدة (متاحة الآن / قريباً) وإعلانها بالشات
  // ==========================================================
  async function checkForNewBadges() {
    try {
      const badges = await fetchBadges(config.dataUrl);
      const { active, upcoming } = splitByStatus(badges);
      const current = [...active, ...upcoming];

      if (isFirstRunSeed.value) {
        // أول تشغيل: نسجل الوضع الحالي كمعروف بدون ما نسبام الشات
        current.forEach((b) => announced.add(badgeKey(b)));
        saveAnnounced(announced);
        isFirstRunSeed.value = false;
        console.log(`ℹ️ تسجيل أولي: ${current.length} بادج (بدون إعلان).`);
        return;
      }

      const newOnes = current.filter((b) => !announced.has(badgeKey(b)));
      if (newOnes.length === 0) return;

      for (const badge of newOnes) {
        const statusLabel =
          badge.status === "active" ? "متاحة الآن 🟢" : "متاحة قريبًا 🔵";
        const msg = `🎖️ بادج جديد: "${badge.name}" — ${statusLabel} | التفاصيل: ${config.siteUrl}`;

        for (const channelName of allChannelLogins()) {
          const settings = getChannelSettings(channelName);
          if (settings.newBadgeAlerts) {
            try {
              await client.say(channelName, msg);
            } catch (err) {
              console.error(`❌ فشل الإرسال بقناة ${channelName}:`, err.message);
            }
          }
        }
        announced.add(badgeKey(badge));
      }
      saveAnnounced(announced);
      console.log(`📢 أُعلن عن ${newOnes.length} بادج جديد.`);
    } catch (err) {
      console.error("❌ خطأ فحص البادجات:", err.message);
    }
  }
  const isFirstRunSeed = { value: isFirstRun };

  // ==========================================================
  // رسالة قائمة البادجات (متاحة الآن + قريبًا) — تستخدم لما حد يكتب
  // "بادجات؟" بالشات
  // ==========================================================
  async function sendBadgeList(channel) {
    try {
      const badges = await fetchBadges(config.dataUrl);
      const { active, upcoming } = splitByStatus(badges);

      if (active.length === 0 && upcoming.length === 0) {
        await client.say(channel, "ما فمّة بادجات متاحة أو قريبة حالياً.");
        return;
      }
      if (active.length > 0) {
        const chunks = chunkMessage(
          `🟢 متاحة الآن (${active.length}): `,
          active.map((b) => b.name)
        );
        for (const c of chunks) await client.say(channel, c);
      }
      if (upcoming.length > 0) {
        const chunks = chunkMessage(
          `🔵 متاحة قريبًا (${upcoming.length}): `,
          upcoming.map((b) => b.name)
        );
        for (const c of chunks) await client.say(channel, c);
      }
      await client.say(channel, `⬇️ للحصول على كل المعلومات زوروا موقعنا: ${config.siteUrl}`);
    } catch (err) {
      console.error("❌ خطأ إرسال قائمة البادجات:", err.message);
      await client.say(channel, "صار خطأ وأنا أجيب قائمة البادجات، جربوا بعد شوي.");
    }
  }

  // ==========================================================
  // أوامر التحكم بالإعدادات (مقصورة على البرودكاستر/المودز)
  // !badgebot status
  // !badgebot alerts on|off
  // !badgebot interval <دقايق>
  // وكلمة "بادجات؟" (مفتوحة لأي حد بالشات)
  // ==========================================================
  client.on("message", async (channel, tags, message, self) => {
    if (self) return;

    if (isBadgeListTrigger(message)) {
      await sendBadgeList(channel);
      return;
    }

    if (isBadgesLinkTrigger(message)) {
      client.say(channel, `⬇️ زوروا موقعنا: ${config.siteUrl}`);
      return;
    }

    if (isBoardTrigger(message)) {
      const boardUrl =
        config.boardUrl || `${config.siteUrl.replace(/\/$/, "")}/board.html`;
      client.say(
        channel,
        `📋 رابط لوحة البادجات المتاحة (تنحط كـ Browser Source بـ OBS أو تتبعث لأي حد): ${boardUrl}`
      );
      return;
    }

    // ==========================================================
    // "الطريقة الثانية": ربط قناة بكود مؤقت (بدون تسجيل دخول بتويتش)
    // يكتبه المستخدم بشات قناة البوت نفسها: "!link <code>"
    // (الكود يتولّد من الموقع عن طريق /api/join_start?method=code).
    // نقصره على شات قناة البوت فقط، لأنها القناة الوحيدة المضمون إن
    // البوت داخلها من البداية، وعشان نتفادى استخدام غير مقصود بقنوات
    // ثانية.
    // ==========================================================
    const linkMatch = message.trim().match(/^!link\s+([A-Za-z0-9]{4,10})$/i);
    if (linkMatch) {
      const channelName = channel.replace("#", "").toLowerCase();
      if (channelName !== config.botUsername.toLowerCase()) return;

      const code = linkMatch[1].toUpperCase();
      const requesterLogin = tags.username;
      const requesterId = tags["user-id"];

      if (requesterLogin.toLowerCase() === config.botUsername.toLowerCase()) {
        client.say(channel, "هذا حساب البوت نفسه — ما ينحتاج ربط 😅");
        return;
      }

      const result = await confirmLinkCode(config.joinCodeConfirmUrl, BOT_LINK_SECRET, {
        code,
        login: requesterLogin,
        broadcasterId: requesterId,
      });

      if (!result.ok) {
        client.say(
          channel,
          `@${requesterLogin} ❌ ${result.error || "صار خطأ بالربط"} — تأكدوا من الكود أو ولّدوا كود جديد من الموقع.`
        );
        return;
      }

      dynamicChannels.set(requesterLogin, { newBadgeAlerts: true });
      client.say(
        channel,
        `@${requesterLogin} ✅ تم الربط! داخل لشاتك الحين... اكتب "/mod ${config.botUsername}" بشاتك عشان أصير مشرف وأشتغل بشكل كامل.`
      );

      try {
        await client.join(requesterLogin);
        await client.say(
          requesterLogin,
          `👋 هلا! بوت البادجات دخل قناتكم عن طريق كود الربط — راح يعلن كل بادج جديد ينزل بالموقع تلقائياً، وأي حد يكتب "بادج؟" بالشات توصله قائمة كل البادجات المتاحة والقريبة، أو "بادجات؟" يوصله رابط الموقع مباشرة، و"بورد؟" يوصله رابط لوحة العرض الحية. اكتبوا /mod ${config.botUsername} عشان أصير مشرف بالكامل. الأوامر: !badgebot status`
        );
        console.log(`➕ انضمّ لقناة جديدة (بالكود): ${requesterLogin}`);
      } catch (err) {
        console.error(`❌ فشل الانضمام لقناة ${requesterLogin} بعد تأكيد الكود:`, err.message);
      }
      return;
    }

    if (!message.toLowerCase().startsWith("!badgebot")) return;

    const channelName = channel.replace("#", "");
    const parts = message.trim().split(/\s+/).slice(1);
    const sub = (parts[0] || "").toLowerCase();

    if (sub === "status" || !sub) {
      const s = getChannelSettings(channelName);
      client.say(
        channel,
        `⚙️ إعدادات هذه القناة — تنبيهات البادجات: ${s.newBadgeAlerts ? "مفعّلة ✅" : "موقوفة ❌"} | فترة الفحص: كل ${config.checkIntervalMinutes} دقيقة | اكتبوا "بادج؟" بأي وقت لقائمة كاملة أو "بادجات؟" لرابط الموقع أو "بورد؟" لرابط لوحة العرض`
      );
      return;
    }

    if (!isModOrBroadcaster(tags, channel)) {
      client.say(channel, "هذا الأمر للبرودكاستر/المودز بس.");
      return;
    }

    if (sub === "alerts" && (parts[1] === "on" || parts[1] === "off")) {
      const enabled = parts[1] === "on";
      if (config.channels[channelName]) {
        config.channels[channelName].newBadgeAlerts = enabled;
        saveConfig(config);
      } else {
        // قناة ديناميكية: نحدّث بالذاكرة بس (المصدر الحقيقي Firestore،
        // هذا التبديل يفضل لحد إعادة تشغيل البوت أو المزامنة الجاية)
        dynamicChannels.set(channelName, { newBadgeAlerts: enabled });
      }
      client.say(channel, `تم: تنبيهات البادجات الجديدة ${enabled ? "مفعّلة ✅" : "موقوفة ❌"}`);
    } else if (sub === "interval" && parts[1] && !isNaN(Number(parts[1]))) {
      const mins = Math.max(1, Math.min(60, Number(parts[1])));
      config.checkIntervalMinutes = mins;
      saveConfig(config);
      client.say(channel, `تم: فترة فحص البادجات دابا كل ${mins} دقيقة`);
      restartPolling();
    } else {
      client.say(
        channel,
        'الأوامر: !badgebot status | !badgebot alerts on/off | !badgebot interval <دقايق> | اكتب "بادج؟" لقائمة كاملة أو "بادجات؟" لرابط الموقع أو "بورد؟" لرابط لوحة العرض'
      );
    }
  });

  // ==========================================================
  // تشغيل الحلقات الدورية
  // ==========================================================
  let pollTimer;
  function restartPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(checkForNewBadges, config.checkIntervalMinutes * 60 * 1000);
  }

  await checkForNewBadges(); // فحص أولي عند التشغيل
  restartPolling();

  await syncDynamicChannels(); // نجيب القنوات المربوطة من الموقع فوراً عند التشغيل
  const channelPollMs = Math.max(1, config.channelPollIntervalMinutes || 3) * 60 * 1000;
  setInterval(syncDynamicChannels, channelPollMs);

  await checkModStatus(); // نتأكد فوراً هل البوت مشرف فعلاً بكل قناة
  setInterval(checkModStatus, channelPollMs);

  const broadcastPollMs = Math.max(1, config.broadcastPollIntervalMinutes || 1) * 60 * 1000;
  setInterval(checkPendingBroadcasts, broadcastPollMs); // فحص أوامر البث اليدوي من لوحة التحكم

  console.log('🤖 البوت شغال — فحص البادجات + رد على "بادج؟"/"بادجات؟" + مزامنة القنوات + تحقق حالة الإشراف + بث لوحة التحكم + أوامر !badgebot جاهزة.');
}

main().catch((err) => {
  console.error("❌ فشل تشغيل البوت:", err);
  process.exit(1);
});
