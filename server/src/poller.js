const { normalizeColor, colorFromNumber, normalizeIncomingSpin } = require("./parser");

const PRIMARY =
  process.env.JONBET_DOUBLE_API ||
  "https://jonbet.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1";

const FALLBACKS = [
  PRIMARY,
  "https://jonbet.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1",
  "https://www.jonbet.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1",
].filter((u, i, arr) => arr.indexOf(u) === i);

const INTERVAL_MS = Number(process.env.POLL_MS || 1500);
const TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 8000);
const MAX_ATTEMPTS = 3;
const FAIL_STREAK_BEFORE_BAD = 3;

function mapApiGame(g) {
  if (!g || g.roll == null) return null;
  const number = Number(g.roll);
  if (Number.isNaN(number) || number < 0 || number > 14) return null;

  let color = normalizeColor(g.color);
  if (!color) color = colorFromNumber(number);
  if (!color) return null;

  return normalizeIncomingSpin({
    color,
    number,
    roundId: g.id != null ? String(g.id) : null,
    rolledAt: g.created_at || g.updated_at || null,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchGamesOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const games = await res.json();
    if (!Array.isArray(games)) throw new Error("payload inválido");
    return { games, url };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGamesResilient() {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const url = FALLBACKS[(attempt - 1) % FALLBACKS.length];
    try {
      return await fetchGamesOnce(url);
    } catch (err) {
      lastErr = err;
      await sleep(250 * attempt);
    }
  }
  throw lastErr || new Error("falha ao buscar API");
}

async function ingestGames(db, games, sourceUrl, source = "api") {
  const mapped = [];
  for (const g of games) {
    const spin = mapApiGame(g);
    if (spin) mapped.push(spin);
  }
  mapped.reverse();
  let inserted = 0;
  const receivedAt = new Date().toISOString();
  for (const spin of mapped) {
    const ok = await db.insertSpin({
      ...spin,
      receivedAt,
      source,
      sourceUrl,
    });
    if (ok) inserted += 1;
  }
  return inserted;
}

function startPoller(db, { onInsert } = {}) {
  let stopped = false;
  let busy = false;
  let timer = null;
  let failStreak = 0;
  let lastError = null;
  let lastOkAt = null;

  function markOk(url) {
    failStreak = 0;
    lastError = null;
    lastOkAt = Date.now();
    db.setMeta("last_api_at", new Date().toISOString());
    db.setMeta("last_api_ok", "1");
    db.setMeta("last_api_url", url);
    db.setMeta("api_fail_streak", "0");
    db.setMeta("last_api_error", "");
  }

  function markFail(err) {
    const msg = String(err && err.message ? err.message : err);
    // Jonbet bloqueia IP de datacenter (451) — esperado no Render; não envenenar o sync
    if (/HTTP 451|451/.test(msg)) {
      db.setMeta("cloud_poll_blocked", "1");
      db.setMeta("last_api_error", "HTTP 451 (bloqueio datacenter — use a extensão)");
      // não zera last_api_ok nem dispara fail streak agressivo
      return { blocked: true };
    }
    failStreak += 1;
    lastError = msg;
    db.setMeta("api_fail_streak", String(failStreak));
    db.setMeta("last_api_error", lastError);
    if (failStreak >= FAIL_STREAK_BEFORE_BAD) {
      db.setMeta("last_api_ok", "0");
    }
    return { blocked: false };
  }

  async function tick() {
    if (stopped || busy) {
      scheduleNext(INTERVAL_MS);
      return;
    }
    busy = true;
    try {
      const { games, url } = await fetchGamesResilient();
      const inserted = await ingestGames(db, games, url, "api");
      db.setMeta("cloud_poll_blocked", "0");
      markOk(url);
      if (inserted > 0 && typeof onInsert === "function") onInsert(inserted);
      scheduleNext(INTERVAL_MS);
    } catch (err) {
      const { blocked } = markFail(err);
      // 451: tenta de novo bem mais tarde (extensão é a fonte)
      const backoff = blocked ? 120000 : Math.min(10000, 800 * Math.max(failStreak, 1));
      scheduleNext(backoff);
    } finally {
      busy = false;
    }
  }

  function scheduleNext(ms) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      tick().catch(() => {});
    }, ms);
  }

  tick().catch(() => {});

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    getLastError: () => lastError,
    getFailStreak: () => failStreak,
    getLastOkAt: () => lastOkAt,
    ingestGames,
  };
}

module.exports = {
  startPoller,
  mapApiGame,
  ingestGames,
  fetchGamesResilient,
  API_URL: PRIMARY,
  FALLBACKS,
};
