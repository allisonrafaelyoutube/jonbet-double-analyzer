const fs = require("fs");
const path = require("path");
const notifier = require("node-notifier");

const rulesPath = path.join(__dirname, "..", "config", "rules.json");

let lastAlertAt = 0;
let lastAlertKey = "";

function loadRules() {
  const raw = fs.readFileSync(rulesPath, "utf8");
  return JSON.parse(raw);
}

function saveRules(rules) {
  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2), "utf8");
}

function computeMetrics(spinsNewestFirst) {
  const spins = spinsNewestFirst;
  const total = spins.length;
  const counts = { green: 0, black: 0, white: 0 };
  for (const s of spins) counts[s.color] = (counts[s.color] || 0) + 1;

  let whiteGap = 0;
  for (const s of spins) {
    if (s.color === "white") break;
    whiteGap += 1;
  }

  let streak = 0;
  let streakColor = null;
  if (spins.length) {
    streakColor = spins[0].color;
    for (const s of spins) {
      if (s.color !== streakColor) break;
      streak += 1;
    }
  }

  const last50 = spins.slice(0, 50);
  const c50 = { green: 0, black: 0, white: 0 };
  for (const s of last50) c50[s.color] += 1;

  return {
    total,
    counts,
    whiteGap,
    streak,
    streakColor,
    last50: c50,
  };
}

function maybeAlert(metrics, rules) {
  const now = Date.now();
  const cooldownMs = (rules.cooldownSeconds || 60) * 1000;
  const candidates = [];

  if (rules.whiteGap?.enabled && metrics.whiteGap >= rules.whiteGap.threshold) {
    candidates.push({
      key: `whiteGap:${metrics.whiteGap}`,
      title: "Double — gap de branco",
      message: `${metrics.whiteGap} giros sem branco (limite ${rules.whiteGap.threshold})`,
    });
  }

  if (
    rules.sameColorStreak?.enabled &&
    metrics.streak >= rules.sameColorStreak.threshold &&
    metrics.streakColor &&
    metrics.streakColor !== "white"
  ) {
    candidates.push({
      key: `streak:${metrics.streakColor}:${metrics.streak}`,
      title: "Double — sequência",
      message: `${metrics.streak}x ${metrics.streakColor} seguidos (limite ${rules.sameColorStreak.threshold})`,
    });
  }

  if (!candidates.length) return null;
  if (now - lastAlertAt < cooldownMs) return null;

  const alert = candidates[0];
  lastAlertAt = now;
  lastAlertKey = alert.key;
  try {
    notifier.notify({
      title: alert.title,
      message: alert.message,
      wait: false,
      sound: true,
    });
  } catch {
    // ignore notifier failures on headless
  }
  return alert;
}

module.exports = {
  loadRules,
  saveRules,
  computeMetrics,
  maybeAlert,
};
