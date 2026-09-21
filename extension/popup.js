const KEYS = [
  "serverOk",
  "serverSpins",
  "lastOkAt",
  "lastError",
  "lastInserted",
  "lastSource",
  "lastPageHost",
  "lastPageAt",
  "lastHookAt",
  "apiOk",
  "apiAgeSec",
  "lastHealthAt",
];

function paint(data = {}) {
  const server = document.getElementById("server");
  const page = document.getElementById("page");
  const ping = document.getElementById("ping");
  const err = document.getElementById("err");

  if (data.serverOk === true) {
    server.textContent = `Servidor: online · ${data.serverSpins ?? "?"} giros`;
    server.className = "row ok";
  } else if (data.serverOk === false) {
    server.textContent = "Servidor: offline";
    server.className = "row bad";
  } else {
    server.textContent = "Servidor: …";
    server.className = "row";
  }

  const pageFresh = data.lastPageAt && Date.now() - data.lastPageAt < 120000;
  const hookFresh = data.lastHookAt && Date.now() - data.lastHookAt < 120000;
  if (hookFresh) {
    page.textContent = `Página: hook ok · ${data.lastPageHost || "jonbet"}`;
    page.className = "row ok";
  } else if (pageFresh) {
    page.textContent = `Página: aberta · ${data.lastPageHost || "jonbet"}`;
    page.className = "row ok";
  } else {
    page.textContent = "Página: opcional (API no servidor)";
    page.className = "row";
  }

  if (typeof data.apiAgeSec === "number" && data.serverOk) {
    const age = data.apiAgeSec;
    ping.textContent = data.apiOk
      ? `Sync API: há ${age}s`
      : `Sync API: atrasado · ${age}s`;
    ping.className = data.apiOk && age < 120 ? "row ok" : "row warn";
  } else if (data.lastOkAt) {
    const sec = Math.round((Date.now() - data.lastOkAt) / 1000);
    ping.textContent = `Extensão: envio há ${sec}s`;
    ping.className = "row";
  } else {
    ping.textContent = "Sync: aguardando";
    ping.className = "row";
  }

  if (data.lastError && data.serverOk === false) {
    err.textContent = String(data.lastError).slice(0, 80);
    err.className = "row bad";
  } else {
    err.textContent = "";
    err.className = "row";
  }
}

function readCache() {
  return new Promise((resolve) => {
    chrome.storage.local.get(KEYS, (data) => resolve(data || {}));
  });
}

async function refresh() {
  // 1) pinta cache na hora — nunca fica preso em "checando…"
  paint(await readCache());

  // 2) health rápido no background (≤ ~1.2s)
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const t = setTimeout(finish, 1500);
    try {
      chrome.runtime.sendMessage({ type: "jb-check-server" }, () => {
        clearTimeout(t);
        finish();
      });
    } catch {
      clearTimeout(t);
      finish();
    }
  });

  paint(await readCache());
}

document.getElementById("recheck").addEventListener("click", () => {
  document.getElementById("server").textContent = "Servidor: atualizando…";
  refresh();
});

refresh();
