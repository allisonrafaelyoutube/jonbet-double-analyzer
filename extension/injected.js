(function () {
  "use strict";
  if (window.__jbDoubleAnalyzer) return;
  window.__jbDoubleAnalyzer = true;

  const SOURCE = "jb-double-analyzer";

  function post(payload) {
    window.postMessage({ source: SOURCE, payload }, "*");
  }

  post({
    source: "hook",
    receivedAt: new Date().toISOString(),
    saveRaw: false,
    hookReady: true,
    href: String(location.href),
  });

  function colorFromNumber(n) {
    if (n === 0) return "white";
    if (Number.isNaN(n)) return null;
    if (n >= 1 && n <= 7) return "green";
    if (n >= 8 && n <= 14) return "black";
    return null;
  }

  function bytesToBase64(u8) {
    let s = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  async function toBase64(data) {
    if (data instanceof ArrayBuffer) {
      return bytesToBase64(new Uint8Array(data));
    }
    if (ArrayBuffer.isView(data)) {
      return bytesToBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      const buf = await data.arrayBuffer();
      return bytesToBase64(new Uint8Array(buf));
    }
    return null;
  }

  // DOM scrape desativado: inventava giros com horário errado e não batia com o site.
  // Fonte oficial = API /roulette_games/recent/1 (+ poller no servidor).

  const NativeWS = window.WebSocket;
  function WrappedWebSocket(url, protocols) {
    const ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
    const urlStr = String(url);
    let pendingBinaryMeta = null;

    const handleMessage = (data) => {
      const receivedAt = new Date().toISOString();

      if (typeof data === "string") {
        const isPlaceholder = /^45\d*-\[/.test(data) && data.includes("_placeholder");
        if (isPlaceholder) {
          pendingBinaryMeta = { receivedAt, url: urlStr };
          // Don't flood raw with placeholders
          return;
        }
        // Only persist likely-useful text frames
        const interesting = /"data"|double|roll|complete/i.test(data);
        post({
          source: "websocket",
          url: urlStr,
          receivedAt,
          saveRaw: interesting,
          raw: data,
        });
        return;
      }

      // Binary frame (often follows 451- placeholder)
      Promise.resolve(toBase64(data))
        .then((b64) => {
          if (!b64) return;
          post({
            source: "websocket",
            url: urlStr,
            receivedAt: pendingBinaryMeta?.receivedAt || receivedAt,
            saveRaw: true,
            binary: true,
            binaryBase64: b64,
            raw: { binaryBase64: b64, byteLength: b64.length },
          });
          pendingBinaryMeta = null;
        })
        .catch(() => {});
    };

    // Single listener only — avoid duplicate captures via onmessage wrap
    ws.addEventListener("message", (ev) => handleMessage(ev.data));

    return ws;
  }

  WrappedWebSocket.prototype = NativeWS.prototype;
  Object.assign(WrappedWebSocket, NativeWS);
  window.WebSocket = WrappedWebSocket;

  // Sync via API oficial (mesma fonte do site)
  const API_PATHS = [
    "/api/singleplayer-originals/originals/roulette_games/recent/1",
    "https://jonbet.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1",
  ];
  let apiBusy = false;
  let lastApiTip = "";
  async function pollApi() {
    if (apiBusy) return;
    apiBusy = true;
    try {
      let games = null;
      let apiUrl = API_PATHS[0];
      for (const url of API_PATHS) {
        try {
          const r = await fetch(url, {
            credentials: "include",
            cache: "no-store",
            headers: { Accept: "application/json" },
          });
          if (!r.ok) continue;
          const data = await r.json();
          if (Array.isArray(data) && data.length) {
            games = data;
            apiUrl = url;
            break;
          }
        } catch {
          /* next */
        }
      }
      if (games) {
        const tip = `${games[0]?.id}:${games[0]?.roll}`;
        // ainda reenvia periodicamente para o servidor pegar backlog; evita spam se igual
        if (tip !== lastApiTip || Math.random() < 0.35) {
          lastApiTip = tip;
          post({
            source: "extension-api",
            receivedAt: new Date().toISOString(),
            saveRaw: false,
            apiUrl,
            games,
          });
        }
      }
    } finally {
      apiBusy = false;
    }
  }
  setInterval(pollApi, 2000);
  setTimeout(pollApi, 400);
  setTimeout(pollApi, 1500);

  console.info("[Jonbet Double Analyzer] sync API oficial ativo em", location.host);
})();
