(function () {
  // Bridge ISOLATED ↔ MAIN (injected.js). Fallback inject if MAIN registration fails on older Brave.
  function injectFallback() {
    if (document.documentElement?.dataset?.jbDaInjected === "1") return;
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("injected.js");
      s.async = false;
      (document.documentElement || document.head || document.body).appendChild(s);
      s.onload = () => s.remove();
      if (document.documentElement) document.documentElement.dataset.jbDaInjected = "1";
    } catch {
      /* CSP may block; MAIN world registration is the primary path */
    }
  }

  chrome.runtime
    .sendMessage({
      type: "jb-page-seen",
      href: location.href,
      host: location.host,
    })
    .catch(() => {});

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "jb-double-analyzer") return;
    chrome.runtime
      .sendMessage({ type: "jb-double-event", payload: data.payload })
      .catch(() => {});
  });

  // Small delay: if MAIN world script already ran, skip; otherwise try DOM inject
  setTimeout(injectFallback, 50);
})();
