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

/** Dual Edge v1 — mesma lógica do dashboard (heurísticas de estudo). */
function computeDualEdgeSignal(spins) {
  if (!spins?.length) return null;

  let whiteGap = 0;
  for (const s of spins) {
    if (s.color === "white") break;
    whiteGap += 1;
  }

  let streak = 0;
  const streakColor = spins[0].color;
  for (const s of spins) {
    if (s.color !== streakColor) break;
    streak += 1;
  }

  const candidates = [];

  if (streak >= 5 && streakColor !== "white") {
    const opposite = streakColor === "green" ? "black" : "green";
    candidates.push({
      priority: 100 + streak,
      color: opposite,
      key: `contra:${streakColor}:${streak}`,
      title: `Double — Aposte no ${opposite === "green" ? "VERDE" : "PRETO"}`,
      message: `Contra-sequência: ${streak}x ${streakColor} → entrar na oposta`,
    });
  }

  {
    const seq = [];
    for (const s of spins) {
      if (s.color === "white") break;
      seq.push(s.color);
      if (seq.length >= 8) break;
    }
    if (seq.length >= 5) {
      let alt = true;
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] === seq[i - 1]) {
          alt = false;
          break;
        }
      }
      if (alt) {
        const last = seq[0];
        const breakColor = last === "green" ? "black" : "green";
        candidates.push({
          priority: 90 + seq.length,
          color: breakColor,
          key: `alt:${seq.length}:${last}`,
          title: `Double — Aposte no ${breakColor === "green" ? "VERDE" : "PRETO"}`,
          message: `Quebra de alternância (${seq.length} giros)`,
        });
      }
    }
  }

  {
    const window = spins.slice(0, 12);
    if (window.length >= 12) {
      const c = { green: 0, black: 0, white: 0 };
      for (const s of window) c[s.color] += 1;
      if (c.green <= 2 && c.black > c.green) {
        candidates.push({
          priority: 80 + (2 - c.green),
          color: "green",
          key: `seca:green:${c.green}`,
          title: "Double — Aposte no VERDE",
          message: `Seca de cor: só ${c.green} verde(s) nas últimas 12`,
        });
      }
      if (c.black <= 2 && c.green > c.black) {
        candidates.push({
          priority: 80 + (2 - c.black),
          color: "black",
          key: `seca:black:${c.black}`,
          title: "Double — Aposte no PRETO",
          message: `Seca de cor: só ${c.black} preto(s) nas últimas 12`,
        });
      }
    }
  }

  if (spins[0].color === "white") {
    const window = spins.slice(1, 11);
    const c = { green: 0, black: 0 };
    for (const s of window) {
      if (s.color === "green" || s.color === "black") c[s.color] += 1;
    }
    if (c.green + c.black >= 4) {
      const color = c.green <= c.black ? "green" : "black";
      candidates.push({
        priority: 70,
        color,
        key: `poswhite:${color}`,
        title: `Double — Aposte no ${color === "green" ? "VERDE" : "PRETO"}`,
        message: "Pós-branco: cor mais seca das 10 anteriores",
      });
    }
  }

  if (whiteGap >= 16) {
    candidates.push({
      priority: 60 + Math.min(whiteGap, 40),
      color: "white",
      key: `gap:${whiteGap}`,
      title: "Double — Aposte no BRANCO",
      message: `Gap branco: ${whiteGap} giros sem 0`,
    });
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0] || null;
}

function maybeAlert(metrics, rules, spinsNewestFirst = []) {
  const now = Date.now();
  const cooldownMs = (rules.cooldownSeconds || 45) * 1000;

  const signal =
    spinsNewestFirst.length > 0
      ? computeDualEdgeSignal(spinsNewestFirst)
      : null;

  if (!signal) return null;
  if (now - lastAlertAt < cooldownMs) return null;
  if (signal.key === lastAlertKey) return null;

  lastAlertAt = now;
  lastAlertKey = signal.key;

  try {
    notifier.notify({
      title: signal.title,
      message: signal.message,
      wait: false,
      sound: true,
    });
  } catch {
    // ignore notifier failures on headless
  }

  return {
    key: signal.key,
    title: signal.title,
    message: signal.message,
    color: signal.color,
  };
}

module.exports = {
  loadRules,
  saveRules,
  computeMetrics,
  computeDualEdgeSignal,
  maybeAlert,
};
