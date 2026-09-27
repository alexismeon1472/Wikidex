const ICON_192 = "iVBORw0KGgoAAAANSUhEUgAAAMAAAADAAgMAAAAvsoSUAAAADFBMVEUJDhoRGi5vkf/t8/97kKXuAAADOElEQVR42u1ZvW7bMBA+XWyAyOTB6KzRQF/CnbsEaBt07J53KO4lundskw6ZOuslEgTowgfw4MkgYIHqYP1QEnk8OhUQpCJgW7Dv03ff/ZCUCTCPecyjGVl3iT+CVocvnZXEHi6/t5cX7dVPzpHl22LIcMm7vhlpuIXqV5jgCh6pz4CcPRzvIR+4tIEd59GxdbkR/a36zWr4s6llY0O040UfG59qgIIikuFC9QD5MVYSO+wBaB8DVEAOAKMeARS5A1BVvEz3ynWpjANKV0Mu6QR03uOaW9W1S4WAwck0yroz72wrif2+Y1AyBtUxlBL7EhLcHwQ330tMK3GAsk+j9PFjDVdpgC0sBgAqIrPpaTIqSMawAIBtkkuemmXHqn5Nx/ACAfu2F6ZiKHs9j5Lpwm1hFE0XZRpgB/f9yoJuYQS47hvfAgA83iXmgeRRQv4b8qMsewsaz13JtWQSADnPoP0oLWCgYBgwMQ0BAObBXwUMNgwwTVyUOrOB1CgNAUCe3KLoAHUYYL2BJJEGCpUvRv20CVFCyXfq9Mr9xT0EEETaJ+BS7trqKWZvchNOHEDHmdnI0TgNYwCeoUHVd0dPGp4bJdMFp8mFTmUgAYC4vkO2ncdRHQDsKA0CBjq9obe4vS4pjyOiKKF3QkdvNxgdXL8wHHXlFY7eNOjw7IfhZS33pSGwEFNKlBpXFPnSMAToOg32jDz40+AHmDO2cCRcdk1/trFT7VupITETMVhut4IBW5PCYLg9HQb2R/asrYMVAIgvboaBAspR5ohQg5YBDLfDHAF0bGuNjCM2SYORiyYWgwntHGCw7Yee6NHSQOKSFXm+wZECPg3/QkPjijYTMXyNPBEhJBYTJqZhDIhE9X/5I2QGvArABQDAw7WW2L6/ecGi9UpimtlnuLSQmC46gJHd3HQMmcR+1TFYGYN2RG8F9ltHNAnimrkHFqJSsm6mF9Ko1gAjCNPKOAArUL3Vrktx1VnvaAr0MgZY2155m6hPW9MDWFjz9ssm9M0R4cO7N2wyPsBNv+OeeIolHAYtaiH7yNhftcXQZsw5vvXWxefhJHDgRT/BkIE9PXbOm3FMytrPYx6vefwFoeG+KLdhgSkAAAAASUVORK5CYII=";
const ICON_512 = "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";

const MANIFEST = {
  name: "WikiDex",
  short_name: "WikiDex",
  description: "Catalogue, wishlist, marché et AutoBid WikiMasters.",
  id: "/",
  start_url: "/?source=pwa",
  scope: "/",
  display: "standalone",
  orientation: "any",
  background_color: "#090e1a",
  theme_color: "#0b1020",
  categories: ["utilities", "productivity"],
  icons: [
    {
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any maskable"
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any maskable"
    }
  ]
};

const SERVICE_WORKER = `
const CACHE_NAME = "wikidex-shell-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/probe/") ||
    url.pathname.startsWith("/autobid/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  if (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
  }
});

self.addEventListener("push", event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "WikiDex",
      body: event.data ? event.data.text() : "Nouvelle notification WikiDex"
    };
  }

  const title = payload.title || "WikiDex";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/icon-192.png",
    image: payload.image || undefined,
    tag: payload.tag || "wikidex",
    data: payload.data || { url: "/?tab=autobid" },
    requireInteraction: !!payload.requireInteraction,
    timestamp: payload.timestamp || Date.now()
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target =
    event.notification?.data?.url ||
    "/?tab=autobid";

  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(clients => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
    })
  );
});

self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
`;

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function manifestResponse() {
  return new Response(JSON.stringify(MANIFEST, null, 2), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff"
    }
  });
}

export function serviceWorkerResponse() {
  return new Response(SERVICE_WORKER, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "service-worker-allowed": "/",
      "x-content-type-options": "nosniff"
    }
  });
}

export function iconResponse(size) {
  const bytes = decodeBase64(size === 512 ? ICON_512 : ICON_192);
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=604800, immutable",
      "x-content-type-options": "nosniff"
    }
  });
}
