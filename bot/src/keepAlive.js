// Render (وأي منصة استضافة مجانية شبيهة) يحتاج خدمتك "تفتح بورت" وترد على
// طلبات HTTP باش يعتبرها شغّالة. البوت نفسه ما يحتاج هذا شي (يتصل
// بتويتش بس)، فهذا سيرفر بسيط جداً هدفه الوحيد إنه يخلي المنصة توافق
// إن الخدمة "حية"، وبنفس الوقت يستخدم كـ endpoint خفيف نرسله له كل
// كم دقيقة (عن طريق خدمة مجانية زي UptimeRobot) عشان يمنع المنصة من
// تنويم الخدمة بعد فترة عدم نشاط.

const http = require("http");

function startKeepAliveServer() {
  const port = process.env.PORT || 3001;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("بوت البادجات شغّال ✅");
  });
  server.listen(port, () => {
    console.log(`🌐 سيرفر keep-alive شغّال على المنفذ ${port} (لمنصات زي Render).`);
  });
  return server;
}

module.exports = { startKeepAliveServer };
