if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());

  self.addEventListener("activate", (event) =>
    event.waitUntil(self.clients.claim())
  );

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (!res || res.status === 0) return res;
          const headers = new Headers(res.headers);
          headers.set("Cross-Origin-Embedder-Policy", "require-corp");
          headers.set("Cross-Origin-Resource-Policy", "cross-origin");
          headers.set("Cross-Origin-Opener-Policy", "same-origin");
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers,
          });
        })
        .catch((err) => new Response(String(err), { status: 500 }))
    );
  });
} else {
  (() => {
    const RELOAD_KEY = "coi-reload-attempted";
    if (window.crossOriginIsolated) {
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch (e) {
        void e;
      }
      return;
    }
    if (!window.isSecureContext || !navigator.serviceWorker) return;

    const src =
      (document.currentScript && document.currentScript.src) ||
      "coi-serviceworker.js";

    const reloadOnce = () => {
      let tried = null;
      try {
        tried = sessionStorage.getItem(RELOAD_KEY);
        sessionStorage.setItem(RELOAD_KEY, "1");
      } catch (e) {
        void e;
      }
      if (!tried) window.location.reload();
    };

    navigator.serviceWorker
      .register(src)
      .then((reg) => {
        reg.addEventListener("updatefound", reloadOnce);
        if (reg.active && !navigator.serviceWorker.controller) reloadOnce();
      })
      .catch((e) => {
        void e;
      });
  })();
}
