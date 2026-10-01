// يحفظ قائمة "المفاتيح" اللي سبق أعلن عنها البوت بالشات، باش ما
// يكررش نفس الإعلان كل مرة يفحص فيها.

const fs = require("fs");
const path = require("path");

const STATE_PATH = path.join(__dirname, "..", "state.json");

function loadAnnounced() {
  if (!fs.existsSync(STATE_PATH)) return new Set();
  try {
    const arr = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function saveAnnounced(set) {
  fs.writeFileSync(STATE_PATH, JSON.stringify([...set], null, 2));
}

module.exports = { loadAnnounced, saveAnnounced };
