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

  function scrapeNewestSpin() {
    const all = Array.from(document.querySelectorAll("body *"));
    const labels = all.filter((el) => {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent || "").trim().toLowerCase())
        .join(" ");
      const t = own || (el.children.length === 0 ? (el.textContent || "").trim().toLowerCase() : "");
      return t === "giros anteriores" || t === "previous rolls" || /^giros anteriores/.test(t);
    });

    let root = null;
    for (const label of labels) {
      const parent = label.parentElement;
      if (!parent) continue;
      const candidates = [parent, parent.nextElementSibling, parent.parentElement].filter(Boolean);
      for (const c of candidates) {
        let count = 0;
        for (const n of c.querySelectorAll("div, span, button, a")) {
          if (/^(0|1[0-4]|[1-9])$/.test((n.textContent || "").trim())) count += 1;
        }
        if (count >= 5) {
          root = c;
          break;
        }
      }
      if (root) break;
    }

    if (!root) {
      const numbered = all.filter((el) => {
        const t = (el.textContent || "").trim();
        return /^(0|1[0-4]|[1-9])$/.test(t) && el.children.length === 0;
      });
      if (numbered.length < 8) return null;
      root = numbered[0].parentElement;
    }

    const cells = Array.from(root.querySelectorAll("div, span, button, a"))
      .filter((el) => /^(0|1[0-4]|[1-9])$/.test((el.textContent || "").trim()))
      .map((el) => {
        const number = Number((el.textContent || "").trim());
        const left = el.getBoundingClientRect().left;
        return { number, left, color: colorFromNumber(number) };
      })
      .filter((c) => c.color && c.number >= 0 && c.number <= 14);

    if (!cells.length) return null;
    cells.sort((a, b) => a.left - b.left);
    const newest = cells[0];
    return { color: newest.color, number: newest.number, roundId: null };
  }

  let lastNewestKey = "";
  let seeded = false;
  function pollDom() {
    try {
      const spin = scrapeNewestSpin();
      if (!spin) return;
      const key = `${spin.color}:${spin.number}`;
      if (!seeded) {
        // First sighting: remember history tip, don't flood DB with whole strip
        lastNewestKey = key;
        seeded = true;
        return;
      }
      if (key === lastNewestKey) return;
      lastNewestKey = key;
      post({
        source: "dom",
        receivedAt: new Date().toISOString(),
        saveRaw: false,
        spin,
      });
    } catch {
      /* ignore */
    }
  }

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

  setInterval(pollDom, 1500);
  setTimeout(pollDom, 1200);
  setTimeout(pollDom, 3500);

  // Sync paralelo via API oficial (não depende do WebSocket binário)
  const API_PATHS = [
    "/api/singleplayer-originals/originals/roulette_games/recent/1",
    "https://jonbet.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1",
  ];
  let apiBusy = false;
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
        post({
          source: "extension-api",
          receivedAt: new Date().toISOString(),
          saveRaw: false,
          apiUrl,
          games,
        });
      }
    } finally {
      apiBusy = false;
    }
  }
  setInterval(pollApi, 3000);
  setTimeout(pollApi, 800);
  setTimeout(pollApi, 2500);

  console.info("[Jonbet Double Analyzer] hook + API sync ativo em", location.host);
})();
