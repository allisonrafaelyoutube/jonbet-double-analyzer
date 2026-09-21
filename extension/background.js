const LOCAL_SERVER = "http://127.0.0.1:8787";
let SERVER = LOCAL_SERVER;

const JONBET_API =
  "https://jonbet.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1";

const HEALTH_MS = 1200;
const POST_MS = 2500;
const API_MS = 3000;

function timedFetch(url, opts = {}, ms = HEALTH_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function checkServer() {
  try {
    const r = await timedFetch(`${LOCAL_SERVER}/health`, { cache: "no-store" }, HEALTH_MS);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    SERVER = LOCAL_SERVER;
    await chrome.storage.local.set({
      serverOk: true,
      serverSpins: data.spins,
      lastHealthAt: Date.now(),
      lastError: null,
      apiOk: !!data.apiOk,
      apiAgeSec: data.apiAgeSec,
      serverUrl: SERVER,
    });
    return { ok: true, data };
  } catch (err) {
    await chrome.storage.local.set({
      serverOk: false,
      lastError: String(err && err.message ? err.message : err),
    });
    return { ok: false, error: String(err) };
  }
}

async function pollJonbetApi() {
  try {
    const r = await timedFetch(
      JONBET_API,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
      },
      API_MS
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const games = await r.json();
    if (!Array.isArray(games) || !games.length) return;

    const res = await timedFetch(
      `${LOCAL_SERVER}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "bg-api",
          receivedAt: new Date().toISOString(),
          saveRaw: false,
          apiUrl: JONBET_API,
          games,
        }),
      },
      POST_MS
    );
    const data = await res.json().catch(() => ({}));
    await chrome.storage.local.set({
      lastOkAt: Date.now(),
      lastInserted: data.inserted || 0,
      lastSource: "bg-api",
      lastError: null,
      serverOk: true,
      serverUrl: LOCAL_SERVER,
      serverSpins: data.spins,
    });
  } catch (err) {
    await chrome.storage.local.set({
      lastBgApiError: String(err && err.message ? err.message : err),
    });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "jb-check-server") {
    checkServer().then(sendResponse).catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg && msg.type === "jb-get-status") {
    chrome.storage.local.get(null).then(sendResponse);
    return true;
  }

  if (msg && msg.type === "jb-page-seen") {
    chrome.storage.local.set({
      lastPageHost: msg.host || "",
      lastPageHref: msg.href || "",
      lastPageAt: Date.now(),
    });
    sendResponse({ ok: true });
    return false;
  }

  if (!msg || msg.type !== "jb-double-event") return;

  const payload = msg.payload || {};

  if (payload.hookReady) {
    chrome.storage.local.set({
      lastHookAt: Date.now(),
      lastPageHost: sender?.tab?.url ? new URL(sender.tab.url).host : payload.href || "",
      lastPageAt: Date.now(),
    });
    sendResponse({ ok: true, hook: true });
    return false;
  }

  timedFetch(
    `${LOCAL_SERVER}/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    POST_MS
  )
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      await chrome.storage.local.set({
        lastOkAt: Date.now(),
        lastError: null,
        lastInserted: data.inserted || 0,
        serverOk: true,
        lastSource: payload.source || "unknown",
        serverUrl: LOCAL_SERVER,
      });
      sendResponse({ ok: r.ok, data });
    })
    .catch(async (err) => {
      await chrome.storage.local.set({
        serverOk: false,
        lastError: String(err && err.message ? err.message : err),
      });
      sendResponse({ ok: false, error: String(err) });
    });

  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  checkServer();
  pollJonbetApi();
});

chrome.runtime.onStartup.addListener(() => {
  checkServer();
  pollJonbetApi();
});

checkServer();
pollJonbetApi();

chrome.alarms.create("health", { periodInMinutes: 0.5 });
chrome.alarms.create("api-sync", { periodInMinutes: 0.05 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "health") checkServer();
  if (alarm.name === "api-sync") pollJonbetApi();
});
