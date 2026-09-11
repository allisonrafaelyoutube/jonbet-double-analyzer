const SERVER = "http://127.0.0.1:8787";
const JONBET_API =
  "https://jonbet.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1";

async function checkServer() {
  try {
    const r = await fetch(`${SERVER}/health`);
    const data = await r.json();
    await chrome.storage.local.set({
      serverOk: true,
      serverSpins: data.spins,
      lastHealthAt: Date.now(),
      lastError: null,
      apiOk: !!data.apiOk,
      apiAgeSec: data.apiAgeSec,
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
    const r = await fetch(JONBET_API, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const games = await r.json();
    if (!Array.isArray(games) || !games.length) return;

    const res = await fetch(`${SERVER}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "bg-api",
        receivedAt: new Date().toISOString(),
        saveRaw: false,
        apiUrl: JONBET_API,
        games,
      }),
    });
    const data = await res.json().catch(() => ({}));
    await chrome.storage.local.set({
      lastOkAt: Date.now(),
      lastInserted: data.inserted || 0,
      lastSource: "bg-api",
      lastError: null,
      serverOk: true,
    });
  } catch (err) {
    // silencioso — o poller do servidor também tenta
    await chrome.storage.local.set({
      lastBgApiError: String(err && err.message ? err.message : err),
    });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "jb-check-server") {
    checkServer().then(sendResponse);
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

  fetch(`${SERVER}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(async (r) => {
      const data = await r.json().catch(() => ({}));
      await chrome.storage.local.set({
        lastOkAt: Date.now(),
        lastError: null,
        lastInserted: data.inserted || 0,
        serverOk: true,
        lastSource: payload.source || "unknown",
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

// Alarmes curtos (dev/unpacked) + fallback por tick do service worker
chrome.alarms.create("health", { periodInMinutes: 0.5 });
chrome.alarms.create("api-sync", { periodInMinutes: 0.05 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "health") checkServer();
  if (alarm.name === "api-sync") pollJonbetApi();
});
