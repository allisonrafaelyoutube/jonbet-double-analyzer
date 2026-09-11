function paint(data) {
  const server = document.getElementById("server");
  const page = document.getElementById("page");
  const ping = document.getElementById("ping");
  const err = document.getElementById("err");

  if (data.serverOk) {
    server.textContent = `Servidor: online (${data.serverSpins ?? "?"} giros)`;
    server.className = "row ok";
  } else {
    server.textContent = "Servidor: offline — rode start-server.bat";
    server.className = "row bad";
  }

  const pageFresh = data.lastPageAt && Date.now() - data.lastPageAt < 120000;
  const hookFresh = data.lastHookAt && Date.now() - data.lastHookAt < 120000;
  if (pageFresh || hookFresh) {
    const host = data.lastPageHost || "jonbet";
    page.textContent = hookFresh
      ? `Página: hook ativo (${host})`
      : `Página: detectada (${host})`;
    page.className = "row ok";
  } else {
    page.textContent = "Página: opcional — giros vêm da API no servidor";
    page.className = "row";
  }

  if (data.lastOkAt) {
    const sec = Math.round((Date.now() - data.lastOkAt) / 1000);
    const src = data.lastSource ? ` via ${data.lastSource}` : "";
    ping.textContent = `Último envio extensão: há ${sec}s (${data.lastInserted ?? 0}${src})`;
  } else {
    ping.textContent = "Extensão: sem envio (normal — servidor puxa a API)";
  }

  if (data.lastError && !data.serverOk) {
    err.textContent = `Erro: ${data.lastError}`;
    err.className = "row bad";
  } else {
    err.textContent = "";
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: "jb-check-server" }, () => {
    chrome.storage.local.get(
      [
        "serverOk",
        "serverSpins",
        "lastOkAt",
        "lastError",
        "lastInserted",
        "lastSource",
        "lastPageHost",
        "lastPageAt",
        "lastHookAt",
      ],
      paint
    );
  });
}

document.getElementById("recheck").addEventListener("click", refresh);
refresh();
