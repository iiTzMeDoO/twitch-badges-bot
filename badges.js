// يجيب البادجات من api/public_badges (endpoint بالموقع يرجع نفس
// البادجات اللي يشوفها الزوار بالضبط: قاعدة js/data.js مدموجة مع
// badgeOverrides وextraBadges من Firestore — يعني يشمل كمان البادجات
// اللي تنضاف/تتعدل يدويًا من admin.html، مو بس القائمة الأساسية).
//
// قبل كذا كان البوت يجيب js/data.js الخام مباشرة (بدون الدمج فوق) وهذا
// كان يخلي رقم البادجات المتاحة/القريبة يطلع مختلف عن الموقع. لسا يدعم
// الشكل القديم (رابط ينتهي بـ data.js خام، نص JS فيه badgesData) كـ
// fallback لو حد رجّع dataUrl القديم بالخطأ.

const fetch = require("node-fetch");
const vm = require("vm");

function parseRawDataJs(jsText) {
  // "const badgesData = [...]" ما يتحطش تلقائياً كـ property على سياق الـ
  // vm (خاصية بـ const/let)، فنلحق بنفس السكريبت سطر يصدّرها صراحة —
  // لازم يكون بنفس التشغيلة (نفس الـ scope) باش يشوف المتغير.
  const wrapped =
    jsText +
    '\n;module.exports = (typeof badgesData !== "undefined") ? badgesData : module.exports;';

  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox, { timeout: 5000 });

  const badges = sandbox.module.exports;
  if (!Array.isArray(badges)) {
    throw new Error("data.js ما رجعش مصفوفة بادجات صالحة");
  }
  return badges;
}

async function fetchBadges(dataUrl) {
  const resp = await fetch(dataUrl, {
    headers: { "Cache-Control": "no-cache" },
  });
  if (!resp.ok) {
    throw new Error(`فشل جلب البادجات: HTTP ${resp.status}`);
  }
  const rawText = await resp.text();

  // الشكل الجديد (api/public_badges): JSON {"badges": [...]}
  let isJson = true;
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    isJson = false; // مو JSON، جرب الشكل القديم (data.js خام) تحت
  }

  if (isJson) {
    if (parsed && Array.isArray(parsed.badges)) return parsed.badges;
    if (Array.isArray(parsed)) return parsed;
    // ردّ JSON صحيح لكن شكله مو اللي نتوقعه — لا تكمّل على parseRawDataJs
    // (بترمي "Unexpected token ':'" لأنها بتحاول تشغّل JSON كأنه JS).
    // اطبع أول 300 حرف عشان تعرفوا شكل الرد الفعلي وتعدّلوا المفتاح تحت.
    console.error(
      "⚠️ رد dataUrl JSON لكن ما فيه مصفوفة badges. أول 300 حرف من الرد:\n",
      rawText.slice(0, 300)
    );
    throw new Error(
      "شكل رد dataUrl (JSON) مو متوقع — راجع console.error فوق لمعرفة المفاتيح الفعلية"
    );
  }

  return parseRawDataJs(rawText);
}

// يرجع { active: [...], upcoming: [...] } من كل البادجات
function splitByStatus(badges) {
  // ملاحظة: نظام الموقع يستخدم status = "available" | "soon" | "expired"
  // (مو "active"/"upcoming")، فلازم نطابق نفس القيم هون وإلا البوت ما
  // يلقى أي بادج نشط أو قريب أبداً.
  const active = badges.filter((b) => b.status === "available");
  const upcoming = badges.filter((b) => b.status === "soon");
  return { active, upcoming };
}

// مفتاح فريد نستخدمه باش نعرف واش سبق أعلنّا عن هالحالة لهاد البادج
function badgeKey(badge) {
  return `${badge.name}::${badge.status}`;
}

module.exports = { fetchBadges, splitByStatus, badgeKey };
